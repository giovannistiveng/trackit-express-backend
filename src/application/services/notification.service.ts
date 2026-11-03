import { Notificacion } from '../../domain/entities/notificacion.entity';
import { NotificationRepositoryPort } from '../../domain/repositories/notification.repository.port';
import { EventBusPort } from '../../domain/repositories/platform.ports';
import { PushService } from './push.service';

export interface OpcionesNotificacion {
  /** Avisos al instante a las pestañas abiertas (SSE). */
  bus?: EventBusPort;
  /** Notificaciones push al navegador o al celular. */
  push?: PushService;
}

/** Ruta de la app que abre la notificación push; el frontend redirige según el rol. */
export function rutaNotificacion(n: Pick<Notificacion, 'tipo' | 'id_envio'>): string {
  if (n.tipo === 'nuevo_servicio') return '/conductor/tablero';
  if (n.tipo === 'liquidacion' || n.tipo === 'calificacion_recibida') return '/conductor/ganancias';
  if (n.tipo === 'conductor_aprobado' || n.tipo === 'conductor_rechazado') return '/conductor/perfil';
  return n.id_envio ? `/envios/${n.id_envio}` : '/';
}

/**
 * Crea avisos dentro de la aplicación, los entrega al instante a las sesiones abiertas y los
 * envía como push. Igual que la auditoría, un fallo al notificar nunca interrumpe la operación.
 */
export class NotificationService {
  constructor(
    private readonly repo: NotificationRepositoryPort,
    private readonly alFallar: (error: unknown) => void = () => undefined,
    private readonly o: OpcionesNotificacion = {},
  ) {}

  async notificar(n: Notificacion): Promise<void> {
    const aviso = { ...n, titulo: n.titulo.slice(0, 120), mensaje: n.mensaje.slice(0, 300) };
    let id: number | null = null;
    try {
      id = await this.repo.save(aviso);
    } catch (error) {
      this.alFallar(error);
    }
    this.o.bus?.publicar(n.id_usuario, {
      tipo: 'notificacion',
      datos: { id, tipo: aviso.tipo, titulo: aviso.titulo, mensaje: aviso.mensaje, id_envio: aviso.id_envio ?? null, leida: false, fecha: new Date().toISOString() },
    });
    if (this.o.push) {
      void this.o.push.enviar(n.id_usuario, {
        titulo: aviso.titulo,
        cuerpo: aviso.mensaje,
        url: rutaNotificacion(aviso),
        etiqueta: aviso.id_envio ? `envio-${aviso.id_envio}` : aviso.tipo,
      });
    }
  }

  /** Evento en tiempo real sin guardar notificación (mensajes de chat, cambios del envío). */
  emitir(id_usuario: number, tipo: 'chat' | 'envio' | 'pago', datos: unknown): void {
    this.o.bus?.publicar(id_usuario, { tipo, datos });
  }

  /** Push sin guardar notificación (p. ej. un mensaje de chat). */
  async push(id_usuario: number, titulo: string, cuerpo: string, url: string, etiqueta?: string): Promise<void> {
    await this.o.push?.enviar(id_usuario, { titulo, cuerpo, url, etiqueta });
  }
}
