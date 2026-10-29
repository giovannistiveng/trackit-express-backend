import { Actor } from '../../../domain/entities/actor.entity';
import { NotificationRepositoryPort } from '../../../domain/repositories/notification.repository.port';
import { NotFoundError } from '../../../shared/errors';
import { idValido } from '../../validation';

/** Avisos del usuario autenticado, con el total sin leer. */
export class ListNotificationsUseCase {
  constructor(private readonly repo: NotificationRepositoryPort) {}

  async execute(actor: Actor, q: { no_leidas?: unknown; limite?: unknown } = {}) {
    const soloNoLeidas = q.no_leidas === 'true' || q.no_leidas === true;
    const limite = Math.min(100, Math.max(1, Number.parseInt(String(q.limite ?? '30'), 10) || 30));
    const [items, noLeidas] = await Promise.all([this.repo.findByUser(actor.userId, { soloNoLeidas, limite }), this.repo.countUnread(actor.userId)]);
    return {
      no_leidas: noLeidas,
      items: items.map((n) => ({
        id: n.id as number,
        tipo: n.tipo,
        titulo: n.titulo,
        mensaje: n.mensaje,
        id_envio: n.id_envio ?? null,
        leida: !!n.leida,
        fecha: (n.fecha ?? new Date()).toISOString(),
      })),
    };
  }
}

export class CountUnreadNotificationsUseCase {
  constructor(private readonly repo: NotificationRepositoryPort) {}

  async execute(actor: Actor) {
    return { no_leidas: await this.repo.countUnread(actor.userId) };
  }
}

export class MarkNotificationReadUseCase {
  constructor(private readonly repo: NotificationRepositoryPort) {}

  async execute(actor: Actor, idCrudo: unknown): Promise<void> {
    const id = idValido(idCrudo, 'id de la notificación');
    if (!(await this.repo.markRead(id, actor.userId))) throw new NotFoundError('No existe esa notificación');
  }
}

export class MarkAllNotificationsReadUseCase {
  constructor(private readonly repo: NotificationRepositoryPort) {}

  async execute(actor: Actor) {
    return { marcadas: await this.repo.markAllRead(actor.userId) };
  }
}
