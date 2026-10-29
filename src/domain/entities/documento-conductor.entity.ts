export type TipoDocumento = 'Cédula' | 'SOAT' | 'Licencia';

export interface DocumentoConductor {
  id?: number;
  tipo_documento: TipoDocumento;
  url_archivo: string;
  id_conductor: number;
  fecha_subida?: Date;
}