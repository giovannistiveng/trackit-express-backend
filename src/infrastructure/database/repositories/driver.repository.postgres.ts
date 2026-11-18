import { VehicleCategory } from '../../../domain/entities/vehicle.entity';
import { Pool } from 'pg';
import { Conductor, EstadoAprobacion } from '../../../domain/entities/driver.entity';
import { DriverRepositoryPort } from '../../../domain/ports/driver.repository.port';

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

  async listApplicants(): Promise<Conductor[]> {
    const r = await this.pool.query<ConductorRow>(
      `SELECT c.id_conductor, c.id_usuario, c.estado_aprobacion, c.motivo_rechazo, u.nombre, u.correo
       FROM Conductor c
       JOIN Usuario u ON u.id_usuario = c.id_usuario
       WHERE c.estado_aprobacion IN ('Pendiente', 'Rechazado', 'Suspendido')
          OR EXISTS (
            SELECT 1 FROM (
              SELECT DISTINCT ON (dc.tipo_documento) dc.estado
              FROM Documento_Conductor dc
              WHERE dc.id_conductor = c.id_conductor
              ORDER BY dc.tipo_documento, dc.fecha_subida DESC, dc.id_documento DESC
            ) ult WHERE ult.estado = 'Pendiente'
          )
       ORDER BY CASE c.estado_aprobacion WHEN 'Pendiente' THEN 0 WHEN 'Suspendido' THEN 1 WHEN 'Aprobado' THEN 2 ELSE 3 END, c.id_conductor`,
    );
    return r.rows.map((row) => this.mapRow(row));
  }

  async averageRating(id_conductor: number): Promise<number | null> {
    const r = await this.pool.query<{ promedio: string | null }>(
      `SELECT ROUND(AVG(ca.puntuacion)::numeric, 1) AS promedio
       FROM Calificacion ca JOIN Envio e ON e.id_envio = ca.id_envio
       WHERE e.id_conductor = $1`,
      [id_conductor],
    );
    const p = r.rows[0]?.promedio;
    return p == null ? null : Number(p);
  }

  async usuariosDisponibles(categorias: VehicleCategory[]): Promise<number[]> {
    const r = await this.pool.query<{ id_usuario: number }>(
      `SELECT DISTINCT c.id_usuario
       FROM Conductor c
       JOIN Vehiculo v ON v.id_conductor = c.id_conductor AND v.categoria = ANY($1::text[])
       WHERE c.estado_aprobacion = 'Aprobado'
         AND NOT EXISTS (
           SELECT 1 FROM Envio e
           JOIN LATERAL (
             SELECT h.estado FROM Historial_Estado h WHERE h.id_envio = e.id_envio
             ORDER BY h.fecha_cambio DESC, h.id_historial DESC LIMIT 1
           ) ult ON TRUE
           WHERE e.id_conductor = c.id_conductor AND ult.estado IN ('Asignado', 'En Ruta')
         )
       LIMIT 100`,
      [categorias],
    );
    return r.rows.map((x) => x.id_usuario);
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
