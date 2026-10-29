import { Pool } from 'pg';
import { Conductor, EstadoAprobacion } from '../../../domain/entities/driver.entity';
import { ConductorPostulante, DriverRepositoryPort } from '../../../domain/repositories/driver.repository.port';
import { TipoDocumento } from '../../../domain/entities/documento-conductor.entity';

interface ConductorRow {
  id_conductor: number;
  id_usuario: number;
  estado_aprobacion: EstadoAprobacion;
  motivo_rechazo: string | null;
  nombre: string;
  correo: string;
}

const SELECT_CONDUCTOR = `
  SELECT c.id_conductor, c.id_usuario, c.estado_aprobacion, c.motivo_rechazo, u.nombre, u.correo
  FROM Conductor c JOIN Usuario u ON u.id_usuario = c.id_usuario`;

export class DriverRepositoryPostgres implements DriverRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async findById(id_conductor: number): Promise<Conductor | null> {
    const r = await this.pool.query<ConductorRow>(`${SELECT_CONDUCTOR} WHERE c.id_conductor = $1`, [id_conductor]);
    return r.rows[0] ? this.mapRow(r.rows[0]) : null;
  }

  async findByUserId(id_usuario: number): Promise<Conductor | null> {
    const r = await this.pool.query<ConductorRow>(`${SELECT_CONDUCTOR} WHERE c.id_usuario = $1`, [id_usuario]);
    return r.rows[0] ? this.mapRow(r.rows[0]) : null;
  }

  async ensureForUser(id_usuario: number): Promise<Conductor> {
    await this.pool.query(
      `INSERT INTO Conductor (id_usuario, estado_aprobacion) VALUES ($1, 'Pendiente') ON CONFLICT (id_usuario) DO NOTHING`,
      [id_usuario],
    );
    return (await this.findByUserId(id_usuario)) as Conductor;
  }

  async updateApprovalStatus(id_conductor: number, estado: EstadoAprobacion, motivo: string | null = null): Promise<void> {
    await this.pool.query('UPDATE Conductor SET estado_aprobacion = $1, motivo_rechazo = $2 WHERE id_conductor = $3', [
      estado,
      motivo,
      id_conductor,
    ]);
  }

  async listApplicants(): Promise<ConductorPostulante[]> {
    const r = await this.pool.query<ConductorRow & { documentos: { tipo_documento: TipoDocumento; url_archivo: string }[] | null }>(
      `SELECT c.id_conductor, c.id_usuario, c.estado_aprobacion, c.motivo_rechazo, u.nombre, u.correo, docs.documentos
       FROM Conductor c
       JOIN Usuario u ON u.id_usuario = c.id_usuario
       CROSS JOIN LATERAL (
           SELECT json_agg(json_build_object('tipo_documento', d.tipo_documento, 'url_archivo', d.url_archivo) ORDER BY d.tipo_documento) AS documentos
           FROM (
             SELECT DISTINCT ON (dc.tipo_documento) dc.tipo_documento, dc.url_archivo
             FROM Documento_Conductor dc
             WHERE dc.id_conductor = c.id_conductor
             ORDER BY dc.tipo_documento, dc.fecha_subida DESC, dc.id_documento DESC
           ) d
         ) docs
       WHERE c.estado_aprobacion IN ('Pendiente', 'Rechazado')
       ORDER BY (c.estado_aprobacion = 'Pendiente') DESC, c.id_conductor`,
    );
    return r.rows.map((row) => ({ ...this.mapRow(row), documentos: row.documentos ?? [] }));
  }

  async averageRating(id_conductor: number): Promise<number | null> {
    const r = await this.pool.query<{ promedio: string | null }>(
      `SELECT ROUND(AVG(ca.puntuacion)::numeric, 1) AS promedio
       FROM Calificacion ca JOIN Envio e ON e.id_envio = ca.id_envio
       WHERE e.id_conductor = $1`,
      [id_conductor],
    );
    const p = r.rows[0]?.promedio;
    return p === null || p === undefined ? null : Number(p);
  }

  private mapRow(row: ConductorRow): Conductor {
    return {
      id_conductor: row.id_conductor,
      id_usuario: row.id_usuario,
      nombre: row.nombre,
      correo: row.correo,
      estado_aprobacion: row.estado_aprobacion,
      motivo_rechazo: row.motivo_rechazo,
    };
  }
}
