import { Envio } from '../entities/shipment.entity';

export interface ShipmentRepositoryPort {
  create(envio: Omit<Envio, 'id_envio'>): Promise<Envio>;
  findById(id_envio: number): Promise<Envio | null>;
  findByClient(id_cliente: number): Promise<Envio[]>;
  findByDriver(id_conductor: number): Promise<Envio[]>;
  findAvailable(): Promise<Envio[]>;
  updateStatus(id_envio: number, estado: string, id_conductor?: number): Promise<void>;
}