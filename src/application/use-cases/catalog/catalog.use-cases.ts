import { Coordenadas } from '../../../domain/entities/shipment.entity';
import { TarifaVehiculo } from '../../../domain/entities/tarifa-vehiculo.entity';
import { ZonaTarifa } from '../../../domain/entities/zona-tarifa.entity';
import { GeocodingPort, SugerenciaDireccion } from '../../../domain/ports/services.port';
import { TarifaVehiculoRepositoryPort } from '../../../domain/ports/tarifa-vehiculo.repository.port';
import { ZonaTarifaRepositoryPort } from '../../../domain/ports/zona-tarifa.repository.port';
import { CATEGORIA_POR_DEFECTO, HORA_FIN_NOCHE, HORA_INICIO_NOCHE, RECARGO_NOCTURNO } from '../../../domain/services/tarifas';
import { DesgloseTarifa } from '../../../domain/services/tarifas';
import { ValidationError } from '../../../shared/errors';
import { Cotizador, OpcionVehiculo, SolicitudRuta, TARIFAS_POR_DEFECTO } from '../../services/cotizador';
import { numeroEnRango } from '../../validation';

export { categoriaOpcional } from '../../services/cotizador';

export interface ZonaApi {
  id_zona: number;
  nombre_zona: string;
  /** Recargo de la zona en COP (mismo valor que `recargo`; se conserva el nombre por compatibilidad). */
  tarifa_base: number;
  recargo: number;
  centro: Coordenadas | null;
  radio_km: number;
  activa: boolean;
  descripcion: string | null;
}

export function presentarZona(z: ZonaTarifa): ZonaApi {
  return {
    id_zona: z.id_zona as number,
    nombre_zona: z.nombre_zona,
    tarifa_base: z.tarifa_base,
    recargo: z.tarifa_base,
    centro: z.centro ?? null,
    radio_km: z.radio_km ?? 3,
    activa: z.activa !== false,
    descripcion: z.descripcion ?? null,
  };
}

/** Zonas de cobertura activas. */
export class ListZonesUseCase {
  constructor(private readonly zonas: ZonaTarifaRepositoryPort) {}

  async execute(): Promise<ZonaApi[]> {
    return (await this.zonas.findAll()).map(presentarZona);
  }
}

/** Tarifas por vehículo y reglas de recargo (públicas: el cliente ve cómo se calcula su precio). */
export class ListVehicleTariffsUseCase {
  constructor(private readonly tarifas: TarifaVehiculoRepositoryPort) {}

  async execute(): Promise<{ tarifas: TarifaVehiculo[]; recargo_nocturno: number; horario_nocturno: string }> {
    let tarifas: TarifaVehiculo[];
    try {
      tarifas = await this.tarifas.findAll();
    } catch {
      tarifas = [];
    }
    return {
      tarifas: tarifas.length > 0 ? tarifas : TARIFAS_POR_DEFECTO,
      recargo_nocturno: RECARGO_NOCTURNO,
      horario_nocturno: `${HORA_INICIO_NOCHE}:00 a ${HORA_FIN_NOCHE - 1}:59`,
    };
  }
}

export interface QuoteResponse {
  distancia_km: number;
  /** Recargo de zona aplicado (COP). Antes era la tarifa base de la zona. */
  tarifa_base: number;
  tarifa_total: number;
  moneda: 'COP';
  /** Tiempo estimado del trayecto origen → destino, en minutos. */
  duracion_estimada_min: number;
  /** false si alguna dirección no se encontró y la distancia es aproximada. */
  distancia_exacta: boolean;
  categoria: string;
  zona: { id_zona: number; nombre_zona: string };
  zona_origen: { id_zona: number; nombre_zona: string } | null;
  desglose: DesgloseTarifa;
  opciones: OpcionVehiculo[];
  recargo_nocturno_activo: boolean;
  origen_coords: Coordenadas | null;
  destino_coords: Coordenadas | null;
}

const zonaCorta = (z: ZonaTarifa) => ({ id_zona: z.id_zona as number, nombre_zona: z.nombre_zona });

/** CU-005: cotización. La zona se detecta por la ubicación; el precio depende del vehículo. */
export class QuoteShipmentUseCase {
  constructor(private readonly cotizador: Cotizador) {}

  async execute(input: SolicitudRuta): Promise<QuoteResponse> {
    const c = await this.cotizador.cotizar(input);
    return {
      distancia_km: Math.round(c.ruta.distancia_km * 100) / 100,
      tarifa_base: c.desglose.recargo_zona,
      tarifa_total: c.desglose.total,
      moneda: 'COP',
      duracion_estimada_min: c.minutos,
      distancia_exacta: c.ruta.exacta !== false,
      categoria: c.categoria ?? CATEGORIA_POR_DEFECTO,
      zona: zonaCorta(c.zona),
      zona_origen: c.zonaOrigen ? zonaCorta(c.zonaOrigen) : null,
      desglose: c.desglose,
      opciones: c.opciones,
      recargo_nocturno_activo: c.nocturno,
      origen_coords: c.ruta.origen ?? null,
      destino_coords: c.ruta.destino ?? null,
    };
  }
}

/** Autocompletado de direcciones dentro de la región. */
export class SearchAddressUseCase {
  constructor(private readonly geo: GeocodingPort) {}

  async execute(q: unknown): Promise<SugerenciaDireccion[]> {
    const texto = typeof q === 'string' ? q.trim() : '';
    if (texto.length < 3) return [];
    if (texto.length > 120) throw new ValidationError('La búsqueda es demasiado larga');
    return this.geo.buscar(texto);
  }
}

/** Dirección aproximada de unas coordenadas ("Usar mi ubicación"). */
export class ReverseGeocodeUseCase {
  constructor(private readonly geo: GeocodingPort) {}

  async execute(lat: unknown, lon: unknown): Promise<SugerenciaDireccion | null> {
    const punto = { lat: numeroEnRango(lat, 'lat', -90, 90), lon: numeroEnRango(lon, 'lon', -180, 180) };
    return this.geo.inversa(punto);
  }
}
