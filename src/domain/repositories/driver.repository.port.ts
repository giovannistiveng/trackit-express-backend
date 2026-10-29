import { Conductor, EstadoAprobacion } from '../entities/driver.entity';

export interface DriverRepositoryPort {
  findById(id_conductor: number): Promise<Conductor | null>;
  updateApprovalStatus(id_conductor: number, estado: EstadoAprobacion): Promise<void>;
}
