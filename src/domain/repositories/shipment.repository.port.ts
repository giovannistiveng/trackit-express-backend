import { Envio, EnvioDetallado, EstadoEnvio } from '../entities/shipment.entity';
import { VehicleCategory } from '../entities/vehicle.entity';

export interface HistorialEstadoRow {
  estado: string;
  fecha_cambio: Date;
}

export interface ShipmentRepositoryPort {
  create(envio: Omit<Envio, 'id_envio'>): Promise<Envio>;
  findById(id_envio: number): Promise<Envio | null>;
  /** Envíos del cliente con conductor y calificación, del más reciente al más antiguo. */
  findByClient(id_cliente: number, estados?: EstadoEnvio[]): Promise<EnvioDetallado[]>;
  findByDriver(id_conductor: number, estados?: EstadoEnvio[]): Promise<Envio[]>;
  /** Envíos Pendiente sin conductor; si se dan categorías, solo los compatibles. */
  findAvailable(categorias?: VehicleCategory[]): Promise<Envio[]>;
  /** Asigna el conductor (solo si el envío no tiene) y registra el estado. */
  updateStatus(id_envio: number, estado: EstadoEnvio, id_conductor?: number): Promise<void>;

  // Trazabilidad (RF8): historial completo, del más reciente al más antiguo
  getStatusHistory(id_envio: number): Promise<HistorialEstadoRow[]>;

  // Validación de entrega (RF9): guarda la evidencia y marca el envío como 'Entregado' (transacción)
  registerDelivery(id_envio: number, url_foto: string): Promise<void>;

  // Calificación (RF10)
  findCalification(id_envio: number): Promise<number | null>;
  saveCalification(id_envio: number, puntuacion: number): Promise<void>;
}
