import { Notificacion } from '../entities/notificacion.entity';

export interface NotificationRepositoryPort {
  /** Guarda y devuelve el id de la notificación. */
  save(n: Notificacion): Promise<number>;
  /** Del más reciente al más antiguo. */
  findByUser(id_usuario: number, o: { soloNoLeidas: boolean; limite: number }): Promise<Notificacion[]>;
  countUnread(id_usuario: number): Promise<number>;
  /** Marca como leída solo si pertenece al usuario; devuelve si existía. */
  markRead(id_notificacion: number, id_usuario: number): Promise<boolean>;
  markAllRead(id_usuario: number): Promise<number>;
  /** Borra una notificación del usuario; devuelve si existía. */
  delete(id_notificacion: number, id_usuario: number): Promise<boolean>;
  /** Borra las notificaciones leídas del usuario. */
  deleteRead(id_usuario: number): Promise<number>;
}
