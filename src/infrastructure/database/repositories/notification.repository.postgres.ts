import { Pool } from 'pg';
import { Notificacion, TipoNotificacion } from '../../../domain/entities/notificacion.entity';
import { NotificationRepositoryPort } from '../../../domain/repositories/notification.repository.port';

interface NotificacionRow {
  id_notificacion: number;
  id_usuario: number;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  id_envio: number | null;
  leida: boolean;
  fecha: Date;
}

export class NotificationRepositoryPostgres implements NotificationRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(n: Notificacion): Promise<void> {
    await this.pool.query(
      'INSERT INTO Notificacion (id_usuario, tipo, titulo, mensaje, id_envio) VALUES ($1, $2, $3, $4, $5)',
      [n.id_usuario, n.tipo, n.titulo, n.mensaje, n.id_envio ?? null],
    );
  }

  async findByUser(id_usuario: number, o: { soloNoLeidas: boolean; limite: number }): Promise<Notificacion[]> {
    const r = await this.pool.query<NotificacionRow>(
      `SELECT * FROM Notificacion
       WHERE id_usuario = $1 AND ($2::boolean = FALSE OR leida = FALSE)
       ORDER BY fecha DESC, id_notificacion DESC LIMIT $3`,
      [id_usuario, o.soloNoLeidas, o.limite],
    );
    return r.rows.map((row) => ({
      id: row.id_notificacion,
      id_usuario: row.id_usuario,
      tipo: row.tipo,
      titulo: row.titulo,
      mensaje: row.mensaje,
      id_envio: row.id_envio,
      leida: row.leida,
      fecha: new Date(row.fecha),
    }));
  }

  async countUnread(id_usuario: number): Promise<number> {
    const r = await this.pool.query<{ total: string }>('SELECT COUNT(*) AS total FROM Notificacion WHERE id_usuario = $1 AND leida = FALSE', [
      id_usuario,
    ]);
    return Number(r.rows[0].total);
  }

  async markRead(id_notificacion: number, id_usuario: number): Promise<boolean> {
    const r = await this.pool.query('UPDATE Notificacion SET leida = TRUE WHERE id_notificacion = $1 AND id_usuario = $2', [
      id_notificacion,
      id_usuario,
    ]);
    return (r.rowCount ?? 0) > 0;
  }

  async markAllRead(id_usuario: number): Promise<number> {
    const r = await this.pool.query('UPDATE Notificacion SET leida = TRUE WHERE id_usuario = $1 AND leida = FALSE', [id_usuario]);
    return r.rowCount ?? 0;
  }
}
