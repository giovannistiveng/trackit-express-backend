import { DocumentoConductor, EstadoDocumento } from '../entities/documento-conductor.entity';

export interface RevisionDocumento {
  estado: Exclude<EstadoDocumento, 'Pendiente'>;
  motivo_rechazo: string | null;
  /** El administrador puede corregir la fecha de vencimiento al revisar. */
  fecha_vencimiento?: Date | null;
  revisado_en: Date;
}

export interface DocumentoConductorRepositoryPort {
  create(documento: Omit<DocumentoConductor, 'id'>): Promise<DocumentoConductor>;
  findById(id: number): Promise<DocumentoConductor | null>;
  /** Todos los documentos del conductor, del más reciente al más antiguo. */
  findByConductor(id_conductor: number): Promise<DocumentoConductor[]>;
  review(id: number, revision: RevisionDocumento): Promise<void>;
  /** Documentos de conductores aprobados que vencen (o antecedentes), para el control diario. */
  findVigilados(): Promise<DocumentoConductor[]>;
  markWarned(id: number, fecha: Date): Promise<void>;
}
