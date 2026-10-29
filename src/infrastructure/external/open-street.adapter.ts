import { config } from '../../config';
import { DistancePort, ResultadoDistancia } from '../../domain/repositories/services.port';
import { logger } from '../../shared/logger';

const log = logger.child('OpenStreetMap');

export interface Coordenadas {
  lat: number;
  lon: number;
}

export class OpenStreetAdapter implements DistancePort {
  private userAgent: string;

  /** Nominatim exige identificar la aplicación con un contacto (NOMINATIM_CONTACT en .env). */
  constructor(contacto: string = config.nominatimContacto) {
    this.userAgent = `TrackIt-Express/2.0 (${contacto})`;
  }

  async calcularDistancia(origen: string, destino: string): Promise<ResultadoDistancia> {
    // Intentar obtener coordenadas reales de OpenStreetMap
    let coordsOrigen: Coordenadas | null = null;
    let coordsDestino: Coordenadas | null = null;

    try {
      coordsOrigen = await this.obtenerCoordenadas(origen);
    } catch (error) {
      log.warn(`No se pudo geocodificar el origen "${origen}"`, error);
    }

    try {
      coordsDestino = await this.obtenerCoordenadas(destino);
    } catch (error) {
      log.warn(`No se pudo geocodificar el destino "${destino}"`, error);
    }

    // Si ambas coordenadas se obtuvieron, usar distancia real
    if (coordsOrigen && coordsDestino) {
      const distanciaKm = this.calcularHaversine(coordsOrigen, coordsDestino);
      const velocidadPromedioKmh = 30;
      const duracionHoras = distanciaKm / velocidadPromedioKmh;
      const duracionSegundos = duracionHoras * 3600;

      log.debug(`Distancia real "${origen}" → "${destino}": ${distanciaKm.toFixed(2)} km`);
      return {
        distancia_km: Math.round(distanciaKm * 100) / 100,
        duracion_segundos: Math.round(duracionSegundos),
        origen: coordsOrigen,
        destino: coordsDestino,
        exacta: true,
      };
    }

    // FALLBACK: distancia simulada basada en las direcciones
    const distanciaSimulada = this.calcularDistanciaSimulada(origen, destino);
    log.warn(
      `Usando distancia simulada (${distanciaSimulada} km) para "${origen}" → "${destino}": ` +
        `origen ${coordsOrigen ? 'ok' : 'sin coordenadas'}, destino ${coordsDestino ? 'ok' : 'sin coordenadas'}`,
    );
    const duracionSegundos = Math.round(distanciaSimulada * 120); // ~2 min por km

    return {
      distancia_km: distanciaSimulada,
      duracion_segundos: duracionSegundos,
      origen: coordsOrigen,
      destino: coordsDestino,
      exacta: false,
    };
  }

  private async obtenerCoordenadas(direccion: string): Promise<Coordenadas | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8 segundos timeout

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(direccion)}&limit=1`;

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': this.userAgent,
          'Accept-Language': 'es',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Error en Nominatim: ${response.status}`);
      }

      const data = (await response.json()) as Array<{ lat: string; lon: string }>;

      if (!Array.isArray(data) || data.length === 0) {
        log.debug(`Nominatim no encontró resultados para "${direccion}"`);
        return null;
      }

      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
      };
    } catch (error) {
      clearTimeout(timeout);
      const motivo =
        error instanceof Error
          ? error.name === 'AbortError'
            ? 'tiempo de espera agotado (8 s)'
            : error.message
          : String(error);
      log.warn(`Fallo consultando Nominatim para "${direccion}": ${motivo}`);
      return null;
    }
  }

  private calcularHaversine(p1: Coordenadas, p2: Coordenadas): number {
    const R = 6371; // Radio de la Tierra en km
    const dLat = this.toRad(p2.lat - p1.lat);
    const dLon = this.toRad(p2.lon - p1.lon);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(p1.lat)) * Math.cos(this.toRad(p2.lat)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(grados: number): number {
    return grados * (Math.PI / 180);
  }

  private calcularDistanciaSimulada(origen: string, destino: string): number {
    const direcciones: Record<string, number> = {
      'casco urbano': 2.5,
      'vereda pekín': 8.5,
      'vereda novillero': 12.0,
      'silvania': 35.0,
      'pasca': 45.0,
      'bogotá': 55.0,
    };

    const origenLower = origen.toLowerCase();
    const destinoLower = destino.toLowerCase();

    let distanciaOrigen = 5;
    let distanciaDestino = 5;

    for (const [clave, distancia] of Object.entries(direcciones)) {
      if (origenLower.includes(clave)) distanciaOrigen = distancia;
      if (destinoLower.includes(clave)) distanciaDestino = distancia;
    }

    return Math.abs(distanciaOrigen - distanciaDestino) + 2;
  }
}
