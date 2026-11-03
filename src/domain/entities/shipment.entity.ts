import type { DesgloseTarifa } from '../services/tarifas';
import { VehicleCategory } from './vehicle.entity';

export type TipoCarga = 'Documentos' | 'Mercancía General' | 'Carga Pesada' | 'Acarreo';

export const ESTADOS_ENVIO = ['Pendiente', 'Asignado', 'En Ruta', 'Entregado', 'Cancelado'] as const;
export type EstadoEnvio = (typeof ESTADOS_ENVIO)[number];

/** Estados en los que un envío ocupa al conductor (RN_OP_002). */
export const ESTADOS_ACTIVOS_CONDUCTOR: EstadoEnvio[] = ['Asignado', 'En Ruta'];
/** Envíos que el cliente todavía está esperando. */
export const ESTADOS_ACTIVOS_CLIENTE: EstadoEnvio[] = ['Pendiente', 'Asignado', 'En Ruta'];
/** Estados finales: no admiten más cambios. */
export const ESTADOS_FINALES: EstadoEnvio[] = ['Entregado', 'Cancelado'];

/** Comisión de la plataforma sobre la tarifa; el resto es ganancia del conductor. */
export const COMISION_PLATAFORMA = 0.2;

export function gananciaConductor(tarifa: number): number {
  return Math.round(tarifa * (1 - COMISION_PLATAFORMA));
}

export interface Coordenadas {
  lat: number;
  lon: number;
}

export interface Envio {
  id_envio?: number;
  origen: string;
  destino: string;
  tipo_carga: string;
  tarifa: number;
  pin_seguridad?: string;
  id_cliente: number;
  id_conductor?: number;
  id_zona: number;
  categoria?: VehicleCategory | null;
  fecha_creacion?: Date;
  origen_coords?: Coordenadas | null;
  destino_coords?: Coordenadas | null;
  distancia_km?: number | null;
  duracion_min?: number | null;
  /** Partidas de la tarifa (banderazo, distancia, tiempo, recargos). */
  desglose?: DesgloseTarifa | null;
  /** Indicaciones del cliente para el conductor (portería, a quién entregar…). */
  notas?: string | null;
  motivo_cancelacion?: string | null;
  metodo_pago?: MetodoPago;
  /** Token del enlace público de seguimiento (quien recibe lo abre sin cuenta). */
  token_seguimiento?: string | null;
  destinatario_nombre?: string | null;
  destinatario_telefono?: string | null;
  /** Envío programado: no aparece en el tablero hasta poco antes de esta hora. */
  fecha_programada?: Date | null;
  aviso_programado?: boolean;
  ida_y_vuelta?: boolean;
  /** Ida y vuelta: momento en que el conductor llegó al destino (antes de volver al origen). */
  destino_visitado_en?: Date | null;
  url_foto_recogida?: string | null;
  fecha_recogida?: Date | null;
  paradas?: Parada[];
  // Estado actual: se obtiene del último registro en Historial_Estado
  estado?: EstadoEnvio;
}

export const METODOS_PAGO = ['efectivo', 'nequi'] as const;
export type MetodoPago = (typeof METODOS_PAGO)[number];

/** Parada intermedia entre el origen y el destino. */
export interface Parada {
  id_parada?: number;
  orden: number;
  direccion: string;
  coords: Coordenadas;
  notas?: string | null;
  completada_en?: Date | null;
}

/** Máximo de paradas intermedias por envío. */
export const MAX_PARADAS = 3;
/** Un envío programado aparece en el tablero esta cantidad de minutos antes de su hora. */
export const ANTICIPO_PROGRAMADO_MIN = 60;
/** Se puede programar con al menos 30 minutos y como máximo 7 días de anticipación. */
export const PROGRAMAR_MINIMO_MIN = 30;
export const PROGRAMAR_MAXIMO_DIAS = 7;

/** Envío con los datos del conductor y la calificación (historial del cliente). */
export interface EnvioDetallado extends Envio {
  fecha_ultimo_cambio?: Date;
  calificacion?: number | null;
  comentario?: string | null;
  conductor?: {
    nombre: string;
    placa?: string | null;
    vehiculo?: string | null;
    calificacion_promedio?: number | null;
  } | null;
}
