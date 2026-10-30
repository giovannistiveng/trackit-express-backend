import { Notificacion } from '../../domain/entities/notificacion.entity';
import { NotificationRepositoryPort } from '../../domain/repositories/notification.repository.port';

/**
 * Crea avisos dentro de la aplicación. Igual que la auditoría, un fallo al notificar
 * nunca interrumpe la operación principal: se informa por el callback de error.
 */
export class NotificationService {
  constructor(
    private readonly repo: NotificationRepositoryPort,
    private readonly alFallar: (error: unknown) => void = () => undefined,
  ) {}

  async notificar(n: Notificacion): Promise<void> {
    try {
      await this.repo.save({ ...n, titulo: n.titulo.slice(0, 120), mensaje: n.mensaje.slice(0, 300) });
    } catch (error) {
      this.alFallar(error);
    }
  }
}
