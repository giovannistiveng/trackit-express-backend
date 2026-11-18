export type EstadoAprobacion = 'Pendiente' | 'Aprobado' | 'Rechazado' | 'Suspendido';

export interface Conductor {
  id_conductor: number;
  id_usuario: number;
  nombre: string;
  correo: string;
  estado_aprobacion: EstadoAprobacion;
  motivo_rechazo?: string | null;
}
