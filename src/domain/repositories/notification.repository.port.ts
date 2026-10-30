import { Notificacion } from '../entities/notificacion.entity';

export interface NotificationRepositoryPort {
  save(n: Notificacion): Promise<void>;
  /** Del más reciente al más antiguo. */
  findByUser(id_usuario: number, o: { soloNoLeidas: boolean; limite: number }): Promise<Notificacion[]>;
  countUnread(id_usuario: number): Promise<number>;
  /** Marca como leída solo si pertenece al usuario; devuelve si existía. */
  markRead(id_notificacion: number, id_usuario: number): Promise<boolean>;
  markAllRead(id_usuario: number): Promise<number>;
}
