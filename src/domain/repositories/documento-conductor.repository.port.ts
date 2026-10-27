import { DocumentoConductor } from '../entities/documento-conductor.entity';

export interface DocumentoConductorRepositoryPort {
  create(documento: Omit<DocumentoConductor, 'id'>): Promise<DocumentoConductor>;
  findByConductor(id_conductor: number): Promise<DocumentoConductor[]>;
  findByIdAndConductor(id_documento: number, id_conductor: number): Promise<DocumentoConductor | null>;
}