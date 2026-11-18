import { Conductor, EstadoAprobacion } from '../entities/driver.entity';
import { VehicleCategory } from '../entities/vehicle.entity';

export interface DriverRepositoryPort {
  findById(id_conductor: number): Promise<Conductor | null>;
  findByUserId(id_usuario: number): Promise<Conductor | null>;
  /** Crea el perfil de conductor (estado Pendiente) si no existe y lo devuelve. */
  ensureForUser(id_usuario: number): Promise<Conductor>;
  updateApprovalStatus(id_conductor: number, estado: EstadoAprobacion, motivo: string | null): Promise<void>;
  /** Conductores por revisar: Pendiente, Rechazado o Suspendido, o con algún documento en revisión. */
  listApplicants(): Promise<Conductor[]>;
  averageRating(id_conductor: number): Promise<number | null>;
  /** id_usuario de conductores aprobados, sin servicio activo, con algún vehículo de estas categorías. */
  usuariosDisponibles(categorias: VehicleCategory[]): Promise<number[]>;
}
