import { Pool } from 'pg';
import { FiltroAuditoria, RegistroAuditoria } from '../../../domain/entities/auditoria.entity';
import { AuditRepositoryPort } from '../../../domain/repositories/audit.repository.port';

interface AuditoriaRow {
  id_auditoria: number;
  fecha: Date;
  id_usuario: number | null;
  correo_usuario: string | null;
  accion: string;
  entidad: string;
  id_entidad: number | null;
  detalle: string | null;
  total: string;
}

export class AuditRepositoryPostgres implements AuditRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(r: RegistroAuditoria): Promise<void> {
    await this.pool.query(
      `INSERT INTO Auditoria (id_usuario, correo_usuario, accion, entidad, id_entidad, detalle)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [r.id_usuario ?? null, r.correo_usuario ?? null, r.accion, r.entidad, r.id_entidad ?? null, r.detalle ?? null],
    );
  }

  async search(f: FiltroAuditoria): Promise<{ items: RegistroAuditoria[]; total: number }> {
    const patron = f.texto ? `%${f.texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const r = await this.pool.query<AuditoriaRow>(
      `SELECT a.*, COUNT(*) OVER() AS total
       FROM Auditoria a
       WHERE ($1::text IS NULL OR a.accion = $1)
         AND ($2::text IS NULL OR a.correo_usuario ILIKE $2 OR a.accion ILIKE $2 OR a.entidad ILIKE $2 OR a.detalle ILIKE $2)
       ORDER BY a.fecha DESC, a.id_auditoria DESC
       LIMIT $3 OFFSET $4`,
      [f.accion ?? null, patron, f.tamano, (f.pagina - 1) * f.tamano],
    );
    let total = r.rows[0] ? Number(r.rows[0].total) : 0;
    if (r.rows.length === 0 && f.pagina > 1) {
      const c = await this.pool.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM Auditoria a
         WHERE ($1::text IS NULL OR a.accion = $1)
           AND ($2::text IS NULL OR a.correo_usuario ILIKE $2 OR a.accion ILIKE $2 OR a.entidad ILIKE $2 OR a.detalle ILIKE $2)`,
        [f.accion ?? null, patron],
      );
      total = Number(c.rows[0].total);
    }
    return {
      total,
      items: r.rows.map((row) => ({
        id: row.id_auditoria,
        fecha: new Date(row.fecha),
        id_usuario: row.id_usuario,
        correo_usuario: row.correo_usuario,
        accion: row.accion,
        entidad: row.entidad,
        id_entidad: row.id_entidad,
        detalle: row.detalle,
      })),
    };
  }
}
