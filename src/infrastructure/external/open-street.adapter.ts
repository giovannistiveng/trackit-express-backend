import { config } from '../../config';
import { Coordenadas } from '../../domain/entities/shipment.entity';
import {
  DistancePort,
  GeocodingPort,
  PuntosConocidos,
  ResultadoDistancia,
  SugerenciaDireccion,
} from '../../domain/ports/services.port';
import { coordenadasValidas, haversineKm, minutosEstimados } from '../../domain/services/geo';
import { logger } from '../../shared/logger';

const log = logger.child('OpenStreetMap');

export type { Coordenadas };

/** Centro de la operación (parque principal de Fusagasugá). */
export const CENTRO_OPERACION: Coordenadas = { lat: 4.3365, lon: -74.3638 };
/** Resultados más lejanos que esto se descartan (evita que "Calle 5" caiga en otro país). */
export const RADIO_MAXIMO_KM = 80;
/** Caja de búsqueda preferida: provincia del Sumapaz y alrededores (oeste, norte, este, sur). */
const CAJA_REGION = '-74.75,4.65,-74.0,4.0';
/** Factor carretera / línea recta cuando OSRM no responde. */
export const FACTOR_RUTA = 1.35;

const TIEMPO_ESPERA_MS = 7000;
const VIGENCIA_CACHE_MS = 24 * 60 * 60 * 1000;
/** Nominatim pide como máximo una petición por segundo. */
const PAUSA_NOMINATIM_MS = 1100;

type Fetch = typeof fetch;

interface ResultadoNominatim {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  address?: Record<string, string>;
}

/** Texto corto a partir de la dirección estructurada de Nominatim. */
export function nombreCorto(r: ResultadoNominatim): string {
  const a = r.address ?? {};
  const via = [a['road'], a['house_number']].filter(Boolean).join(' ');
  const lugar = r.name && r.name !== a['road'] ? r.name : '';
  const barrio = a['neighbourhood'] ?? a['suburb'] ?? a['hamlet'] ?? a['village'];
  const municipio = a['town'] ?? a['city'] ?? a['municipality'] ?? a['county'];
  const partes = [lugar, via, barrio, municipio].filter((p, i, arr) => p && arr.indexOf(p) === i);
  return (partes.length ? partes.join(', ') : r.display_name.split(',').slice(0, 3).join(',')).slice(0, 200);
}

class CacheTemporal<T> {
  private readonly datos = new Map<string, { valor: T; vence: number }>();
  constructor(private readonly max = 500) {}

  obtener(clave: string): T | undefined {
    const e = this.datos.get(clave);
    if (!e) return undefined;
    if (e.vence < Date.now()) {
      this.datos.delete(clave);
      return undefined;
    }
    return e.valor;
  }

  guardar(clave: string, valor: T): void {
    if (this.datos.size >= this.max) this.datos.delete(this.datos.keys().next().value as string);
    this.datos.set(clave, { valor, vence: Date.now() + VIGENCIA_CACHE_MS });
  }
}

/**
 * OpenStreetMap: Nominatim para buscar direcciones y OSRM para la distancia por carretera.
 * Si un servicio no responde, se estima con línea recta × 1,35 a 30 km/h.
 */
export class OpenStreetAdapter implements DistancePort, GeocodingPort {
  private readonly userAgent: string;
  private readonly cacheBusqueda = new CacheTemporal<SugerenciaDireccion[]>();
  private readonly cacheRuta = new CacheTemporal<{ km: number; segundos: number }>();
  private cola: Promise<unknown> = Promise.resolve();
  private ultimaPeticion = 0;

  /** Nominatim exige identificar la aplicación con un contacto (NOMINATIM_CONTACT en .env). */
  constructor(
    contacto: string = config.nominatimContacto,
    private readonly http: Fetch = (...a) => fetch(...a),
    private readonly urlOsrm = 'https://router.project-osrm.org',
    private readonly urlNominatim = 'https://nominatim.openstreetmap.org',
    private readonly pausaMs = PAUSA_NOMINATIM_MS,
  ) {
    this.userAgent = `TrackIt-Express/2.1 (${contacto})`;
  }

  // ------------------------------------------------------------ Geocodificación

  async buscar(texto: string): Promise<SugerenciaDireccion[]> {
    const q = texto.trim().replace(/\s+/g, ' ');
    if (q.length < 3) return [];
    const clave = q.toLowerCase();
    const enCache = this.cacheBusqueda.obtener(clave);
    if (enCache) return enCache;

    // 1) Dentro de la región; 2) en Cundinamarca; 3) en Colombia. Siempre cerca del centro.
    const intentos: Record<string, string>[] = [
      { q, viewbox: CAJA_REGION, bounded: '1' },
      { q: /cundinamarca|colombia/i.test(q) ? q : `${q}, Cundinamarca` },
    ];
    let resultados: SugerenciaDireccion[] = [];
    for (const extra of intentos) {
      const crudos = await this.nominatim('/search', { format: 'jsonv2', addressdetails: '1', limit: '6', countrycodes: 'co', ...extra });
      resultados = (Array.isArray(crudos) ? (crudos as ResultadoNominatim[]) : [])
        .map((r) => ({ nombre: nombreCorto(r), detalle: r.display_name, coords: { lat: Number(r.lat), lon: Number(r.lon) } }))
        .filter((s) => coordenadasValidas(s.coords) && haversineKm(CENTRO_OPERACION, s.coords) <= RADIO_MAXIMO_KM);
      if (resultados.length > 0) break;
    }
    const unicos = resultados.filter((s, i, arr) => arr.findIndex((o) => o.nombre === s.nombre) === i).slice(0, 5);
    this.cacheBusqueda.guardar(clave, unicos);
    return unicos;
  }

  async inversa(punto: Coordenadas): Promise<SugerenciaDireccion | null> {
    const r = await this.nominatim('/reverse', {
      format: 'jsonv2',
      addressdetails: '1',
      zoom: '18',
      lat: String(punto.lat),
      lon: String(punto.lon),
    });
    const uno = r as ResultadoNominatim | null;
    if (!uno || typeof uno.display_name !== 'string') return null;
    return { nombre: nombreCorto(uno), detalle: uno.display_name, coords: { lat: punto.lat, lon: punto.lon } };
  }

  // ------------------------------------------------------------ Distancia

  async calcularDistancia(origen: string, destino: string, conocidos: PuntosConocidos = {}): Promise<ResultadoDistancia> {
    const [coordsOrigen, coordsDestino] = await Promise.all([
      coordenadasValidas(conocidos.origen) ? conocidos.origen : this.geocodificar(origen),
      coordenadasValidas(conocidos.destino) ? conocidos.destino : this.geocodificar(destino),
    ]);

    if (coordsOrigen && coordsDestino) {
      const ruta = await this.rutaPorCarretera(coordsOrigen, coordsDestino);
      return {
        distancia_km: Math.round(ruta.km * 100) / 100,
        duracion_segundos: Math.round(ruta.segundos),
        origen: coordsOrigen,
        destino: coordsDestino,
        exacta: true,
      };
    }

    const km = this.distanciaSimulada(origen, destino);
    log.warn(
      `Distancia estimada (${km} km) para "${origen}" → "${destino}": ` +
        `origen ${coordsOrigen ? 'ok' : 'sin coordenadas'}, destino ${coordsDestino ? 'ok' : 'sin coordenadas'}`,
    );
    return {
      distancia_km: km,
      duracion_segundos: minutosEstimados(km / FACTOR_RUTA) * 60,
      origen: coordsOrigen,
      destino: coordsDestino,
      exacta: false,
    };
  }

  private async geocodificar(texto: string): Promise<Coordenadas | null> {
    const [primera] = await this.buscar(texto);
    return primera?.coords ?? null;
  }

  /** Distancia y tiempo por carretera con OSRM; si falla, línea recta × factor. */
  private async rutaPorCarretera(a: Coordenadas, b: Coordenadas): Promise<{ km: number; segundos: number }> {
    const clave = [a.lat, a.lon, b.lat, b.lon].map((n) => n.toFixed(5)).join(',');
    const enCache = this.cacheRuta.obtener(clave);
    if (enCache) return enCache;
    const rectaKm = haversineKm(a, b);
    try {
      const url = `${this.urlOsrm}/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false&alternatives=false`;
      const r = await this.conTiempo(url, {});
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { code?: string; routes?: { distance: number; duration: number }[] };
      const ruta = data.routes?.[0];
      if (data.code !== 'Ok' || !ruta) throw new Error(data.code ?? 'sin ruta');
      // OSRM usa velocidades de carro; un domicilio real en la región va algo más lento.
      const resultado = { km: ruta.distance / 1000, segundos: Math.max(ruta.duration * 1.25, 60) };
      this.cacheRuta.guardar(clave, resultado);
      return resultado;
    } catch (e) {
      log.warn(`OSRM no respondió (${e instanceof Error ? e.message : String(e)}); se estima con línea recta`);
      const km = Math.max(0.3, rectaKm * FACTOR_RUTA);
      return { km, segundos: minutosEstimados(rectaKm) * 60 };
    }
  }

  // ------------------------------------------------------------ HTTP

  private async nominatim(ruta: string, params: Record<string, string>): Promise<unknown> {
    const url = `${this.urlNominatim}${ruta}?${new URLSearchParams(params).toString()}`;
    // Serializa las llamadas para respetar el límite de Nominatim
    const turno = this.cola.then(async () => {
      const espera = this.ultimaPeticion + this.pausaMs - Date.now();
      if (espera > 0) await new Promise((r) => setTimeout(r, espera));
      this.ultimaPeticion = Date.now();
      try {
        const r = await this.conTiempo(url, { 'User-Agent': this.userAgent, 'Accept-Language': 'es' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as unknown;
      } catch (e) {
        log.warn(`Fallo consultando Nominatim (${ruta}): ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    });
    this.cola = turno.catch(() => undefined);
    return turno;
  }

  private async conTiempo(url: string, headers: Record<string, string>): Promise<Response> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), TIEMPO_ESPERA_MS);
    try {
      return await this.http(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(t);
    }
  }

  /** Último recurso cuando no se encontró alguna dirección: distancias típicas desde el centro. */
  private distanciaSimulada(origen: string, destino: string): number {
    const lugares: Record<string, number> = {
      'casco urbano': 0,
      'vereda pekín': 6,
      'vereda novillero': 7,
      chinauta: 12,
      silvania: 13,
      pasca: 14,
      arbeláez: 20,
    };
    const lejania = (texto: string) => {
      const t = texto.toLowerCase();
      const hallado = Object.entries(lugares).find(([clave]) => t.includes(clave));
      return hallado ? hallado[1] : 1.5;
    };
    return Math.round((Math.abs(lejania(origen) - lejania(destino)) + 3) * 100) / 100;
  }
}
