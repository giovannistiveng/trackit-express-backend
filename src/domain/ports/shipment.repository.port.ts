import { Envio, EnvioDetallado, EstadoEnvio } from '../entities/shipment.entity';
import { VehicleCategory } from '../entities/vehicle.entity';

export interface HistorialEstadoRow {
  estado: string;
  fecha_cambio: Date;
}

/** Envío con nombres de cliente y conductor (panel administrativo). */
export interface EnvioAdmin extends Envio {
  cliente_nombre: string;
  cliente_correo: string;
  conductor_nombre: string | null;
  zona_nombre: string;
  fecha_ultimo_cambio?: Date;
}

export interface FiltroEnviosAdmin {
  estado?: EstadoEnvio;
  id_zona?: number;
  texto?: string;
  pagina: number;
  tamano: number;
}

/** Lo que el cliente puede corregir mientras el envío está Pendiente (no cambia el precio). */
export interface DetallesEditables {
  tipo_carga?: string;
  notas?: string | null;
  destinatario_nombre?: string | null;
  destinatario_telefono?: string | null;
}

export interface ResumenConductor {
  completados: number;
  ingresos_total: number;
  ingresos_mes: number;
  calificacion_promedio: number | null;
  total_calificaciones: number;
}

export interface ShipmentRepositoryPort {
  create(envio: Omit<Envio, 'id_envio'>): Promise<Envio>;
  findById(id_envio: number): Promise<Envio | null>;
  /** Envíos del cliente con conductor y calificación, del más reciente al más antiguo. */
  findByClient(id_cliente: number, estados?: EstadoEnvio[]): Promise<EnvioDetallado[]>;
  findByDriver(id_conductor: number, estados?: EstadoEnvio[]): Promise<Envio[]>;
  /**
   * Pendientes sin conductor, con el pago garantizado y (si son programados) a menos de una hora.
   * Con `categorias`, solo los de esas categorías o sin categoría.
   */
  findAvailable(categorias?: VehicleCategory[], ahora?: Date): Promise<Envio[]>;
  /** Envío por el token del enlace público de seguimiento. */
  findByToken(token: string): Promise<Envio | null>;
  updateDetalles(id_envio: number, d: DetallesEditables): Promise<void>;
  /** Guarda la foto de recogida y pasa el envío a En Ruta (transacción). */
  registerPickup(id_envio: number, url_foto: string, ahora: Date): Promise<void>;
  markDestinationVisited(id_envio: number, ahora: Date): Promise<void>;
  /** Programados que ya entran al tablero y todavía no se anunciaron a los conductores. */
  findScheduledToAnnounce(ahora: Date): Promise<Envio[]>;
  markScheduledAnnounced(id_envio: number): Promise<void>;
  /** Asigna el conductor (solo si el envío no tiene) y registra el estado. */
  updateStatus(id_envio: number, estado: EstadoEnvio, id_conductor?: number): Promise<void>;

  // Trazabilidad (RF8): historial completo, del más reciente al más antiguo
  getStatusHistory(id_envio: number): Promise<HistorialEstadoRow[]>;

  // Validación de entrega (RF9): guarda la evidencia y marca el envío como 'Entregado' (transacción)
  registerDelivery(id_envio: number, url_foto: string): Promise<void>;

  // Calificación (RF10)
  findCalification(id_envio: number): Promise<number | null>;
  saveCalification(id_envio: number, puntuacion: number, comentario?: string | null): Promise<void>;

  /** Cancela el envío (registra el estado y el motivo). Falla si ya está en un estado final. */
  cancel(id_envio: number, motivo: string | null): Promise<void>;
  /** Servicios terminados del conductor (Entregado), con calificación y comentario. */
  findDriverHistory(id_conductor: number, limite: number): Promise<EnvioDetallado[]>;
  driverSummary(id_conductor: number): Promise<ResumenConductor>;
  searchAdmin(f: FiltroEnviosAdmin): Promise<{ items: EnvioAdmin[]; total: number }>;
}
