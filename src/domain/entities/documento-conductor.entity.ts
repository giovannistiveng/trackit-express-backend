export const TIPOS_DOCUMENTO = ['Cédula', 'Selfie', 'Licencia', 'SOAT', 'Tecnomecánica', 'Tarjeta de propiedad', 'Antecedentes'] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export const ESTADOS_DOCUMENTO = ['Pendiente', 'Aprobado', 'Rechazado'] as const;
export type EstadoDocumento = (typeof ESTADOS_DOCUMENTO)[number];

export interface DocumentoConductor {
  id?: number;
  tipo_documento: TipoDocumento;
  url_archivo: string;
  id_conductor: number;
  fecha_subida?: Date;
  /** Revisión del administrador. */
  estado?: EstadoDocumento;
  motivo_rechazo?: string | null;
  /** SOAT, licencia y tecnomecánica vencen; los antecedentes se renuevan cada año. */
  fecha_vencimiento?: Date | null;
  revisado_en?: Date | null;
  /** Cuándo se avisó al conductor que el documento estaba por vencer. */
  aviso_vencimiento_en?: Date | null;
}
