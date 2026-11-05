export interface RegistroAuditoria {
  id?: number;
  fecha?: Date;
  id_usuario?: number | null;
  correo_usuario?: string | null;
  accion: string;
  entidad: string;
  id_entidad?: number | null;
  detalle?: string | null;
}

export interface FiltroAuditoria {
  texto?: string;
  accion?: string;
  pagina: number;
  tamano: number;
}
