import { Envio } from '../entities/shipment.entity';

export interface HistorialEstadoRow {
  estado: string;
  fecha_cambio: Date;
}

export interface ShipmentRepositoryPort {
  create(envio: Omit<Envio, 'id_envio'>): Promise<Envio>;
  findById(id_envio: number): Promise<Envio | null>;
  findByClient(id_cliente: number): Promise<Envio[]>;
  findByDriver(id_conductor: number): Promise<Envio[]>;
  findAvailable(): Promise<Envio[]>;
  updateStatus(id_envio: number, estado: string, id_conductor?: number): Promise<void>;
  conductorExists(id_conductor: number): Promise<boolean>;

  // Trazabilidad (RF8): historial completo, del más reciente al más antiguo
  getStatusHistory(id_envio: number): Promise<HistorialEstadoRow[]>;

  // Validación de entrega (RF9): guarda la evidencia y marca el envío como 'Entregado' (transacción)
  registerDelivery(id_envio: number, url_foto: string): Promise<void>;

  // Calificación (RF10)
  findCalification(id_envio: number): Promise<number | null>;
  saveCalification(id_envio: number, puntuacion: number): Promise<void>;
}
