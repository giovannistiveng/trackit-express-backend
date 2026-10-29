import { Pool } from 'pg';
import { Conductor, EstadoAprobacion } from '../../../domain/entities/driver.entity';
import { DriverRepositoryPort } from '../../../domain/repositories/driver.repository.port';

export class DriverRepositoryPostgres implements DriverRepositoryPort {
  constructor(private pool: Pool) {}

  async findById(id_conductor: number): Promise<Conductor | null> {
    const result = await this.pool.query(
      `SELECT c.id_conductor, c.id_usuario, c.estado_aprobacion, u.nombre, u.correo
       FROM Conductor c
       JOIN Usuario u ON u.id_usuario = c.id_usuario
       WHERE c.id_conductor = $1`,
      [id_conductor]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id_conductor: row.id_conductor,
      id_usuario: row.id_usuario,
      nombre: row.nombre,
      correo: row.correo,
      estado_aprobacion: row.estado_aprobacion,
    };
  }

  async updateApprovalStatus(id_conductor: number, estado: EstadoAprobacion): Promise<void> {
    await this.pool.query('UPDATE Conductor SET estado_aprobacion = $1 WHERE id_conductor = $2', [
      estado,
      id_conductor,
    ]);
  }
}
