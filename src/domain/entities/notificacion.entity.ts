export const TIPOS_NOTIFICACION = [
  'envio_aceptado',
  'ruta_iniciada',
  'envio_entregado',
  'envio_cancelado',
  'conductor_aprobado',
  'conductor_rechazado',
  'calificacion_recibida',
] as const;
export type TipoNotificacion = (typeof TIPOS_NOTIFICACION)[number];

export interface Notificacion {
  id?: number;
  id_usuario: number;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  id_envio?: number | null;
  leida?: boolean;
  fecha?: Date;
}
