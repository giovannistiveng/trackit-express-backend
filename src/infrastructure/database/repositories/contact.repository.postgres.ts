import { Pool } from 'pg';
import { AsuntoContacto, MensajeContacto } from '../../../domain/entities/contacto.entity';
import { ContactRepositoryPort } from '../../../domain/repositories/contact.repository.port';

interface ContactoRow {
  id_contacto: number;
  nombre: string;
  correo: string;
  telefono: string | null;
  asunto: AsuntoContacto;
  mensaje: string;
  atendido: boolean;
  fecha: Date;
  total?: string;
}

function mapear(row: ContactoRow): MensajeContacto {
  return {
    id: row.id_contacto,
    nombre: row.nombre,
    correo: row.correo,
    telefono: row.telefono,
    asunto: row.asunto,
    mensaje: row.mensaje,
    atendido: row.atendido,
    fecha: new Date(row.fecha),
  };
}

export class ContactRepositoryPostgres implements ContactRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(m: MensajeContacto): Promise<MensajeContacto> {
    const r = await this.pool.query<ContactoRow>(
      'INSERT INTO Contacto (nombre, correo, telefono, asunto, mensaje) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [m.nombre, m.correo, m.telefono ?? null, m.asunto, m.mensaje],
    );
    return mapear(r.rows[0]);
  }

  async search(f: { pagina: number; tamano: number; pendientes: boolean }): Promise<{ items: MensajeContacto[]; total: number }> {
    const r = await this.pool.query<ContactoRow>(
      `SELECT c.*, COUNT(*) OVER() AS total FROM Contacto c
       WHERE ($1::boolean = FALSE OR c.atendido = FALSE)
       ORDER BY c.fecha DESC, c.id_contacto DESC LIMIT $2 OFFSET $3`,
      [f.pendientes, f.tamano, (f.pagina - 1) * f.tamano],
    );
    return { total: r.rows[0] ? Number(r.rows[0].total) : 0, items: r.rows.map(mapear) };
  }

  async markAttended(id: number): Promise<boolean> {
    const r = await this.pool.query('UPDATE Contacto SET atendido = TRUE WHERE id_contacto = $1', [id]);
    return (r.rowCount ?? 0) > 0;
  }
}
