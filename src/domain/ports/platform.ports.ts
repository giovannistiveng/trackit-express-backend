import { MensajeChat } from '../entities/chat.entity';
import { Liquidacion, MovimientoConductor, Pago, EstadoPago } from '../entities/pago.entity';
import { Parada } from '../entities/shipment.entity';

// ---------------------------------------------------------------- Cuentas

export type TipoToken = 'verificacion' | 'recuperacion';

export interface TokenRepositoryPort {
  /** Guarda un token (solo su hash) e invalida los anteriores del mismo tipo sin usar. */
  create(id_usuario: number, tipo: TipoToken, token_hash: string, expira: Date): Promise<void>;
  /** Marca el token como usado si existe, es del tipo y no venció; devuelve el usuario. */
  consume(tipo: TipoToken, token_hash: string, ahora: Date): Promise<number | null>;
}

export interface CorreoSaliente {
  para: string;
  asunto: string;
  html: string;
  texto: string;
}

/** Envío de correos (SMTP en producción; buzón local en desarrollo). */
export interface MailerPort {
  enviar(correo: CorreoSaliente): Promise<void>;
}

// ---------------------------------------------------------------- Pagos

export interface FiltroPagos {
  metodo?: string;
  estado?: EstadoPago;
  pagina: number;
  tamano: number;
}

export interface PagoAdmin extends Pago {
  cliente_nombre: string;
  origen: string;
  destino: string;
}

export interface PagoRepositoryPort {
  create(p: Omit<Pago, 'id_pago'>): Promise<Pago>;
  findByEnvio(id_envio: number): Promise<Pago | null>;
  update(id_envio: number, cambios: Partial<Pago>): Promise<Pago | null>;
  /** Pagos Nequi pendientes (para consultar su estado en segundo plano). */
  findPendientesNequi(limite: number): Promise<Pago[]>;
  search(f: FiltroPagos): Promise<{ items: PagoAdmin[]; total: number }>;
}

export interface LiquidacionRepositoryPort {
  /**
   * Crea las liquidaciones del periodo [desde, hasta] con los envíos entregados antes de `hasta`
   * que aún no están liquidados. Devuelve las creadas.
   */
  generar(desde: string, hasta: string): Promise<Liquidacion[]>;
  list(f: { estado?: 'pendiente' | 'pagada'; id_conductor?: number; pagina: number; tamano: number }): Promise<{ items: Liquidacion[]; total: number }>;
  findById(id: number): Promise<Liquidacion | null>;
  marcarPagada(id: number, referencia: string, ahora: Date): Promise<Liquidacion | null>;
  /** Entregas del conductor que todavía no entran en una liquidación. */
  movimientosPendientes(id_conductor: number): Promise<MovimientoConductor[]>;
}

export type EstadoGateway = 'pendiente' | 'aprobado' | 'rechazado' | 'expirado';

/** Pasarela de pagos (Nequi Conecta o simulada). */
export interface PaymentGatewayPort {
  readonly nombre: string;
  /** Envía la notificación de cobro al celular del cliente. */
  solicitarCobro(d: { telefono: string; monto: number; referencia: string }): Promise<{ transaccionId: string }>;
  consultarEstado(transaccionId: string): Promise<{ estado: EstadoGateway; mensaje?: string }>;
  reembolsar(d: { telefono: string; monto: number; transaccionId: string }): Promise<void>;
}

// ---------------------------------------------------------------- Tiempo real y push

export interface EventoTiempoReal {
  tipo: 'notificacion' | 'chat' | 'envio' | 'pago';
  datos: unknown;
}

/** Bus de eventos en memoria para enviar avisos a las sesiones abiertas (SSE). */
export interface EventBusPort {
  publicar(id_usuario: number, evento: EventoTiempoReal): void;
  suscribir(id_usuario: number, fn: (e: EventoTiempoReal) => void): () => void;
}

export type PlataformaPush = 'web' | 'android' | 'ios';

export interface SuscripcionPush {
  id_suscripcion?: number;
  id_usuario: number;
  plataforma: PlataformaPush;
  endpoint: string;
  p256dh?: string | null;
  auth?: string | null;
}

export interface PushRepositoryPort {
  save(s: SuscripcionPush): Promise<void>;
  findByUser(id_usuario: number): Promise<SuscripcionPush[]>;
  delete(endpoint: string, id_usuario?: number): Promise<void>;
}

export interface MensajePush {
  titulo: string;
  cuerpo: string;
  /** Ruta de la app que se abre al tocar la notificación. */
  url: string;
  etiqueta?: string;
}

/** Envía una notificación push a un dispositivo. `false` si la suscripción ya no es válida. */
export interface PushSenderPort {
  readonly plataformas: PlataformaPush[];
  enviar(s: SuscripcionPush, m: MensajePush): Promise<boolean>;
}

// ---------------------------------------------------------------- Envíos avanzados

export interface ParadaRepositoryPort {
  saveAll(id_envio: number, paradas: Parada[]): Promise<void>;
  findByEnvio(id_envio: number): Promise<Parada[]>;
  completar(id_envio: number, id_parada: number, ahora: Date): Promise<boolean>;
}

export interface ChatRepositoryPort {
  save(m: Omit<MensajeChat, 'id_mensaje'>): Promise<MensajeChat>;
  findByEnvio(id_envio: number, limite: number): Promise<MensajeChat[]>;
  /** Marca como leídos los mensajes que el usuario recibió en el envío. */
  markRead(id_envio: number, id_lector: number): Promise<number>;
  countUnread(id_envio: number, id_lector: number): Promise<number>;
}
