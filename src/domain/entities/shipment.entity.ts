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
  /** Indicaciones del cliente para el conductor (portería, a quién entregar…). */
  notas?: string | null;
  motivo_cancelacion?: string | null;
  // Estado actual: se obtiene del último registro en Historial_Estado
  estado?: EstadoEnvio;
}

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
