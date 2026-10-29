import { VehicleCategory } from './vehicle.entity';

export type TipoCarga = 'Documentos' | 'Mercancía General' | 'Carga Pesada' | 'Acarreo';

export const ESTADOS_ENVIO = ['Pendiente', 'Asignado', 'En Ruta', 'Entregado'] as const;
export type EstadoEnvio = (typeof ESTADOS_ENVIO)[number];

/** Estados en los que un envío ocupa al conductor (RN_OP_002). */
export const ESTADOS_ACTIVOS_CONDUCTOR: EstadoEnvio[] = ['Asignado', 'En Ruta'];

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
  // Estado actual: se obtiene del último registro en Historial_Estado
  estado?: EstadoEnvio;
}

/** Envío con los datos del conductor y la calificación (historial del cliente). */
export interface EnvioDetallado extends Envio {
  fecha_ultimo_cambio?: Date;
  calificacion?: number | null;
  conductor?: {
    nombre: string;
    placa?: string | null;
    vehiculo?: string | null;
    calificacion_promedio?: number | null;
  } | null;
}
