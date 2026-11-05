export type EstadoAprobacion = 'Pendiente' | 'Aprobado' | 'Rechazado';

export interface Conductor {
  id_conductor: number;
  id_usuario: number;
  nombre: string;
  correo: string;
  estado_aprobacion: EstadoAprobacion;
  motivo_rechazo?: string | null;
}
