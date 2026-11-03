import { MensajePush, PushRepositoryPort, PushSenderPort } from '../../domain/repositories/platform.ports';

/** Envía una notificación push a todos los dispositivos del usuario y limpia los que ya no sirven. */
export class PushService {
  constructor(
    private readonly repo: PushRepositoryPort,
    private readonly senders: PushSenderPort[],
    private readonly alFallar: (e: unknown) => void = () => undefined,
  ) {}

  get disponible(): boolean {
    return this.senders.length > 0;
  }

  async enviar(id_usuario: number, m: MensajePush): Promise<void> {
    if (this.senders.length === 0) return;
    try {
      const suscripciones = await this.repo.findByUser(id_usuario);
      await Promise.all(
        suscripciones.map(async (s) => {
          const sender = this.senders.find((x) => x.plataformas.includes(s.plataforma));
          if (!sender) return;
          const valida = await sender.enviar(s, m).catch((e) => {
            this.alFallar(e);
            return true;
          });
          if (!valida) await this.repo.delete(s.endpoint);
        }),
      );
    } catch (e) {
      this.alFallar(e);
    }
  }
}
