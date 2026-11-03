import { Actor } from '../../../domain/entities/actor.entity';
import { PlataformaPush, PushRepositoryPort } from '../../../domain/repositories/platform.ports';
import { ValidationError } from '../../../shared/errors';

const PLATAFORMAS: PlataformaPush[] = ['web', 'android', 'ios'];

/**
 * Registra el dispositivo del usuario para notificaciones push.
 *  - web: { plataforma: 'web', endpoint, keys: { p256dh, auth } } (PushSubscription del navegador)
 *  - android / ios: { plataforma, token } (token de Firebase Cloud Messaging de la app Capacitor)
 */
export class SubscribePushUseCase {
  constructor(private readonly repo: PushRepositoryPort) {}

  async execute(actor: Actor, input: Record<string, unknown>): Promise<void> {
    const plataforma = (input['plataforma'] ?? 'web') as PlataformaPush;
    if (!PLATAFORMAS.includes(plataforma)) throw new ValidationError('La plataforma debe ser web, android o ios');
    if (plataforma === 'web') {
      const endpoint = typeof input['endpoint'] === 'string' ? input['endpoint'] : '';
      const keys = (input['keys'] ?? {}) as { p256dh?: unknown; auth?: unknown };
      if (!/^https:\/\/\S{10,690}$/.test(endpoint) || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
        throw new ValidationError('La suscripción del navegador no es válida');
      }
      await this.repo.save({ id_usuario: actor.userId, plataforma, endpoint, p256dh: keys.p256dh.slice(0, 200), auth: keys.auth.slice(0, 100) });
      return;
    }
    const token = typeof input['token'] === 'string' ? input['token'].trim() : '';
    if (!/^[\w:-]{20,690}$/.test(token)) throw new ValidationError('El token del dispositivo no es válido');
    await this.repo.save({ id_usuario: actor.userId, plataforma, endpoint: token });
  }
}

export class UnsubscribePushUseCase {
  constructor(private readonly repo: PushRepositoryPort) {}

  async execute(actor: Actor, input: Record<string, unknown>): Promise<void> {
    const endpoint = typeof input['endpoint'] === 'string' ? input['endpoint'] : typeof input['token'] === 'string' ? input['token'] : '';
    if (!endpoint) throw new ValidationError('Indica la suscripción a eliminar');
    await this.repo.delete(endpoint, actor.userId);
  }
}
