import { Conductor, EstadoAprobacion } from '../entities/driver.entity';
import { DocumentoConductor } from '../entities/documento-conductor.entity';

export interface ConductorPostulante extends Conductor {
  documentos: Pick<DocumentoConductor, 'tipo_documento' | 'url_archivo'>[];
}

export interface DriverRepositoryPort {
  findById(id_conductor: number): Promise<Conductor | null>;
  findByUserId(id_usuario: number): Promise<Conductor | null>;
  /** Crea el perfil de conductor (estado Pendiente) si no existe y lo devuelve. */
  ensureForUser(id_usuario: number): Promise<Conductor>;
  updateApprovalStatus(id_conductor: number, estado: EstadoAprobacion, motivo?: string | null): Promise<void>;
  /** Conductores Pendiente o Rechazado, con el último documento de cada tipo. */
  listApplicants(): Promise<ConductorPostulante[]>;
  averageRating(id_conductor: number): Promise<number | null>;
}
