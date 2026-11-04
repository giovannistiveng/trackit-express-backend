import {
  Coordenadas,
  MAX_PARADAS,
  PROGRAMAR_MAXIMO_DIAS,
  PROGRAMAR_MINIMO_MIN,
  Parada,
} from '../../domain/entities/shipment.entity';
import { TarifaVehiculo } from '../../domain/entities/tarifa-vehiculo.entity';
import { CATEGORIAS_VEHICULO, VehicleCategory } from '../../domain/entities/vehicle.entity';
import { ZonaTarifa } from '../../domain/entities/zona-tarifa.entity';
import { DistancePort, ResultadoDistancia } from '../../domain/ports/services.port';
import { TarifaVehiculoRepositoryPort } from '../../domain/ports/tarifa-vehiculo.repository.port';
import { ZonaTarifaRepositoryPort } from '../../domain/ports/zona-tarifa.repository.port';
import { coordenadasValidas } from '../../domain/services/geo';
import {
  CATEGORIA_POR_DEFECTO,
  DesgloseTarifa,
  calcularTarifaDetallada,
  esNocturno,
  zonaDelPunto,
} from '../../domain/services/tarifas';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { coordenadasOpcionales, idValido, textoOpcional, textoValido } from '../validation';

/** Tarifas de respaldo si la tabla Tarifa_Vehiculo aún no existe o está vacía (migración 003 pendiente). */
export const TARIFAS_POR_DEFECTO: TarifaVehiculo[] = [
  { categoria: 'Moto Express', banderazo: 2000, por_km: 700, por_minuto: 50, minimo: 4500 },
  { categoria: 'Motocarro', banderazo: 4000, por_km: 950, por_minuto: 80, minimo: 8000 },
  { categoria: 'Camioneta', banderazo: 10000, por_km: 1600, por_minuto: 120, minimo: 18000 },
];

export interface SolicitudRuta {
  origen: unknown;
  destino: unknown;
  id_zona?: unknown;
  categoria?: unknown;
  origen_coords?: unknown;
  destino_coords?: unknown;
  /** Paradas intermedias [{ direccion, coords, notas? }] (máximo 3, con coordenadas). */
  paradas?: unknown;
  ida_y_vuelta?: unknown;
  /** Fecha y hora ISO para programar el envío. */
  fecha_programada?: unknown;
}

export interface OpcionVehiculo {
  categoria: VehicleCategory;
  tarifa_total: number;
  minimo_aplicado: boolean;
}

export interface Cotizacion {
  origen: string;
  destino: string;
  categoria: VehicleCategory | null;
  zona: ZonaTarifa;
  zonaOrigen: ZonaTarifa | null;
  ruta: ResultadoDistancia;
  minutos: number;
  desglose: DesgloseTarifa;
  opciones: OpcionVehiculo[];
  nocturno: boolean;
  paradas: Parada[];
  idaYVuelta: boolean;
  fechaProgramada: Date | null;
}

/** Paradas validadas: dirección, coordenadas (obligatorias) y notas. */
export function paradasValidas(valor: unknown): Parada[] {
  if (valor === undefined || valor === null || valor === '') return [];
  if (!Array.isArray(valor)) throw new ValidationError('El campo "paradas" debe ser una lista');
  if (valor.length > MAX_PARADAS) throw new ValidationError(`Puedes agregar máximo ${MAX_PARADAS} paradas`);
  return valor.map((p, i) => {
    const v = (p ?? {}) as Record<string, unknown>;
    const coords = coordenadasOpcionales(v['coords'], `paradas[${i}].coords`);
    if (!coords) throw new ValidationError(`Ubica en el mapa la parada ${i + 1}`);
    return {
      orden: i + 1,
      direccion: textoValido(v['direccion'], `paradas[${i}].direccion`, 3, 200),
      coords,
      notas: textoOpcional(v['notas'], `paradas[${i}].notas`, 200),
    };
  });
}

/** Fecha programada válida (entre 30 minutos y 7 días en el futuro) o null. */
export function fechaProgramadaValida(valor: unknown, ahora: Date): Date | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const f = new Date(String(valor));
  if (Number.isNaN(f.getTime())) throw new ValidationError('La fecha programada no es válida');
  const minutos = (f.getTime() - ahora.getTime()) / 60_000;
  if (minutos < PROGRAMAR_MINIMO_MIN) {
    throw new ValidationError(`Programa el envío con al menos ${PROGRAMAR_MINIMO_MIN} minutos de anticipación`);
  }
  if (minutos > PROGRAMAR_MAXIMO_DIAS * 24 * 60) {
    throw new ValidationError(`Solo se puede programar hasta con ${PROGRAMAR_MAXIMO_DIAS} días de anticipación`);
  }
  return f;
}

export function categoriaOpcional(valor: unknown): VehicleCategory | null {
  if (valor === undefined || valor === null || valor === '') return null;
  if (!(CATEGORIAS_VEHICULO as readonly string[]).includes(String(valor))) {
    throw new ValidationError('Categoría inválida. Debe ser: Moto Express, Motocarro o Camioneta');
  }
  return valor as VehicleCategory;
}

/**
 * Calcula el precio de un viaje:
 * 1. Distancia y tiempo por carretera (coordenadas del mapa o dirección buscada).
 * 2. Zona de origen y destino según su ubicación; el recargo es el mayor de los dos.
 * 3. Precio del vehículo (banderazo + km + minutos, con mínimo) + recargo de zona + nocturno.
 */
export class Cotizador {
  constructor(
    private readonly zonas: ZonaTarifaRepositoryPort,
    private readonly tarifas: TarifaVehiculoRepositoryPort,
    private readonly distancia: DistancePort,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async cotizar(input: SolicitudRuta): Promise<Cotizacion> {
    const origen = textoValido(input.origen, 'origen', 3, 200);
    const destino = textoValido(input.destino, 'destino', 3, 200);
    const categoria = categoriaOpcional(input.categoria);
    const conocidoOrigen = coordenadasOpcionales(input.origen_coords, 'origen_coords');
    const conocidoDestino = coordenadasOpcionales(input.destino_coords, 'destino_coords');
    if (origen.toLowerCase() === destino.toLowerCase() && !conocidoOrigen && !conocidoDestino) {
      throw new ValidationError('El origen y el destino deben ser distintos');
    }

    const paradas = paradasValidas(input.paradas);
    const idaYVuelta = input.ida_y_vuelta === true || input.ida_y_vuelta === 'true';
    const ahora = this.reloj();
    const fechaProgramada = fechaProgramadaValida(input.fecha_programada, ahora);

    const directa = await this.distancia.calcularDistancia(origen, destino, { origen: conocidoOrigen, destino: conocidoDestino });
    if (directa.exacta !== false && directa.distancia_km < 0.05) {
      throw new ValidationError('El origen y el destino son el mismo lugar');
    }
    const ruta = await this.rutaCompleta(origen, destino, directa, paradas, idaYVuelta);
    const zonas = await this.zonas.findAll();
    const zonaOrigen = this.zonaDe(zonas, ruta.origen, 'origen');
    const zona = this.zonaDe(zonas, ruta.destino, 'destino') ?? (await this.zonaManual(input.id_zona));
    const zonasParadas = paradas.map((p, i) => this.zonaDe(zonas, p.coords, `la parada ${i + 1}`) as ZonaTarifa);

    const recargo = Math.max(zona.tarifa_base, zonaOrigen?.tarifa_base ?? 0, ...zonasParadas.map((z) => z.tarifa_base));
    const minutos = Math.max(1, Math.round(ruta.duracion_segundos / 60));
    // El recargo nocturno depende de la hora del servicio, no de cuándo se cotiza
    const fecha = fechaProgramada ?? ahora;
    const tarifas = await this.tarifasVigentes();
    const calcular = (t: TarifaVehiculo) =>
      calcularTarifaDetallada({
        tarifa: t,
        distanciaKm: ruta.distancia_km,
        minutos,
        recargoZona: recargo,
        fecha,
        paradas: paradas.length,
        idaYVuelta,
      });

    const opciones = tarifas.map((t) => {
      const d = calcular(t);
      return { categoria: t.categoria, tarifa_total: d.total, minimo_aplicado: d.minimo_aplicado };
    });
    const elegida = tarifas.find((t) => t.categoria === (categoria ?? CATEGORIA_POR_DEFECTO)) ?? tarifas[0];
    return {
      origen,
      destino,
      categoria,
      zona,
      zonaOrigen,
      ruta,
      minutos,
      desglose: calcular(elegida),
      opciones,
      nocturno: esNocturno(fecha),
      paradas,
      idaYVuelta,
      fechaProgramada,
    };
  }

  /**
   * Con paradas o ida y vuelta, la distancia es la suma de los tramos
   * origen → paradas → destino (→ origen). Exige coordenadas de origen y destino.
   */
  private async rutaCompleta(
    origen: string,
    destino: string,
    directa: ResultadoDistancia,
    paradas: Parada[],
    idaYVuelta: boolean,
  ): Promise<ResultadoDistancia> {
    if (paradas.length === 0 && !idaYVuelta) return directa;
    if (!coordenadasValidas(directa.origen) || !coordenadasValidas(directa.destino) || directa.exacta === false) {
      throw new ValidationError('Para envíos con paradas o de ida y vuelta, ubica el origen y el destino en el mapa');
    }
    const puntos = [
      { texto: origen, coords: directa.origen },
      ...paradas.map((p) => ({ texto: p.direccion, coords: p.coords })),
      { texto: destino, coords: directa.destino },
      ...(idaYVuelta ? [{ texto: origen, coords: directa.origen }] : []),
    ];
    let km = 0;
    let segundos = 0;
    for (let i = 0; i < puntos.length - 1; i++) {
      const a = puntos[i];
      const b = puntos[i + 1];
      const tramo = await this.distancia.calcularDistancia(a.texto, b.texto, { origen: a.coords, destino: b.coords });
      km += tramo.distancia_km;
      segundos += tramo.duracion_segundos;
    }
    return { ...directa, distancia_km: Math.round(km * 100) / 100, duracion_segundos: segundos };
  }

  private zonaDe(zonas: ZonaTarifa[], punto: Coordenadas | null | undefined, cual: string): ZonaTarifa | null {
    if (!coordenadasValidas(punto)) return null;
    const z = zonaDelPunto(zonas, punto);
    if (!z) {
      throw new ValidationError(
        cual.startsWith('la parada')
          ? `${cual[0].toUpperCase()}${cual.slice(1)} está fuera de nuestra zona de cobertura`
          : `La dirección de ${cual} está fuera de nuestra zona de cobertura. Revisa la dirección o elígela en el mapa`,
      );
    }
    return z;
  }

  /** Sin coordenadas del destino, el cliente debe indicar la zona a mano. */
  private async zonaManual(idCrudo: unknown): Promise<ZonaTarifa> {
    if (idCrudo === undefined || idCrudo === null || idCrudo === '') {
      throw new ValidationError('No encontramos la dirección de destino. Elígela en el mapa o selecciona la zona');
    }
    const id = idValido(idCrudo, 'id_zona');
    const zona = await this.zonas.findById(id);
    if (!zona || zona.activa === false) throw new NotFoundError(`No existe la zona de tarifa con id ${id}`);
    return zona;
  }

  private async tarifasVigentes(): Promise<TarifaVehiculo[]> {
    try {
      const t = await this.tarifas.findAll();
      return t.length > 0 ? t : TARIFAS_POR_DEFECTO;
    } catch {
      return TARIFAS_POR_DEFECTO;
    }
  }
}
