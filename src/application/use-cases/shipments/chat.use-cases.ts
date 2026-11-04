import { Actor, ROLES } from '../../../domain/entities/actor.entity';
import { LARGO_MAXIMO_MENSAJE, MensajeChat } from '../../../domain/entities/chat.entity';
import { Envio } from '../../../domain/entities/shipment.entity';
import { DriverRepositoryPort } from '../../../domain/ports/driver.repository.port';
import { ChatRepositoryPort } from '../../../domain/ports/platform.ports';
import { ShipmentRepositoryPort } from '../../../domain/ports/shipment.repository.port';
import { UserRepositoryPort } from '../../../domain/ports/user.repository.port';
import { ForbiddenError, ValidationError } from '../../../shared/errors';
import { envioExistente } from '../../services/access';
import { NotificationService } from '../../services/notification.service';

/** Estados en los que se puede escribir: hay un conductor asignado y el servicio no terminó. */
const ESTADOS_CHAT_ABIERTO = ['Asignado', 'En Ruta'];

interface Participantes {
  envio: Envio;
  rol: 'cliente' | 'conductor' | 'admin';
  /** id_usuario de la otra parte (para avisarle). */
  otro: number | null;
}

async function participantes(envios: ShipmentRepositoryPort, drivers: DriverRepositoryPort, actor: Actor, id: unknown): Promise<Participantes> {
  const envio = await envioExistente(envios, id);
  const conductor = envio.id_conductor ? await drivers.findById(envio.id_conductor) : null;
  if (actor.role === ROLES.CLIENTE && envio.id_cliente === actor.userId) return { envio, rol: 'cliente', otro: conductor?.id_usuario ?? null };
  if (actor.role === ROLES.CONDUCTOR && conductor && conductor.id_usuario === actor.userId) return { envio, rol: 'conductor', otro: envio.id_cliente };
  if (actor.role === ROLES.ADMIN) return { envio, rol: 'admin', otro: null };
  throw new ForbiddenError('No tienes acceso a este chat');
}

function presentar(m: MensajeChat, yo: number) {
  return {
    id: m.id_mensaje,
    texto: m.texto,
    autor: m.autor_nombre?.split(' ')[0] ?? null,
    mio: m.id_usuario === yo,
    leido: !!m.leido,
    fecha: (m.creado ?? new Date()).toISOString(),
  };
}

/** Conversación del envío entre el cliente y el conductor asignado (el administrador solo lee). */
/** Quita caracteres de control (salvo tab y salto de línea) para que no rompan la interfaz. */
export function sinControles(texto: string): string {
  return [...texto]
    .filter((c) => {
      const codigo = c.codePointAt(0) ?? 0;
      return codigo === 9 || codigo === 10 || (codigo >= 32 && codigo !== 127);
    })
    .join('');
}

export class ListChatUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly chat: ChatRepositoryPort,
  ) {}

  async execute(actor: Actor, id: unknown) {
    const p = await participantes(this.envios, this.drivers, actor, id);
    const idEnvio = p.envio.id_envio as number;
    if (p.rol !== 'admin') await this.chat.markRead(idEnvio, actor.userId);
    const mensajes = await this.chat.findByEnvio(idEnvio, 200);
    return {
      abierto: ESTADOS_CHAT_ABIERTO.includes(p.envio.estado ?? 'Pendiente') && p.rol !== 'admin',
      mensajes: mensajes.map((m) => presentar(m, actor.userId)),
    };
  }
}

/** Envía un mensaje: se guarda, llega al instante a la otra parte y como notificación push. */
export class SendChatMessageUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly users: UserRepositoryPort,
    private readonly chat: ChatRepositoryPort,
    private readonly notificaciones: NotificationService,
  ) {}

  async execute(actor: Actor, id: unknown, input: { texto?: unknown }) {
    const p = await participantes(this.envios, this.drivers, actor, id);
    if (p.rol === 'admin') throw new ForbiddenError('El administrador no participa en el chat del envío');
    if (!ESTADOS_CHAT_ABIERTO.includes(p.envio.estado ?? 'Pendiente')) {
      throw new ValidationError('El chat está disponible mientras el envío tiene conductor y no ha terminado');
    }
    const texto = typeof input.texto === 'string' ? sinControles(input.texto).trim() : '';
    if (texto.length < 1) throw new ValidationError('Escribe un mensaje');
    if (texto.length > LARGO_MAXIMO_MENSAJE) throw new ValidationError(`El mensaje admite máximo ${LARGO_MAXIMO_MENSAJE} caracteres`);
    const autor = await this.users.findById(actor.userId);
    const m = await this.chat.save({ id_envio: p.envio.id_envio as number, id_usuario: actor.userId, texto, autor_nombre: autor?.nombre });
    if (p.otro) {
      this.notificaciones.emitir(p.otro, 'chat', { id_envio: p.envio.id_envio, mensaje: presentar(m, p.otro) });
      const quien = p.rol === 'cliente' ? 'El cliente' : (autor?.nombre.split(' ')[0] ?? 'Tu conductor');
      // El push no detiene el envío del mensaje
      this.notificaciones
        .push(p.otro, `${quien} · envío #${p.envio.id_envio}`, texto.slice(0, 140), `/envios/${p.envio.id_envio}?chat=1`, `chat-${p.envio.id_envio}`)
        .catch(() => undefined);
    }
    return presentar(m, actor.userId);
  }
}
