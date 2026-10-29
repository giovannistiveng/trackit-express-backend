import { Pool } from 'pg';
import { ZonaTarifa } from '../../../domain/entities/zona-tarifa.entity';
import { ZonaTarifaRepositoryPort } from '../../../domain/repositories/zona-tarifa.repository.port';

export class ZonaTarifaRepositoryPostgres implements ZonaTarifaRepositoryPort {
  constructor(private pool: Pool) {}

  async findById(id_zona: number): Promise<ZonaTarifa | null> {
    const query = 'SELECT * FROM Zona_Tarifa WHERE id_zona = $1';
    const result = await this.pool.query(query, [id_zona]);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  private mapRow(row: any): ZonaTarifa {
    return {
      id_zona: row.id_zona,
      nombre_zona: row.nombre_zona,
      tarifa_base: Number(row.tarifa_base),
    };
  }
}