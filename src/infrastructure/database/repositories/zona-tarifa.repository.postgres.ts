import { Pool } from 'pg';
import { ZonaTarifa } from '../../../domain/entities/zona-tarifa.entity';
import { ZonaTarifaRepositoryPort } from '../../../domain/repositories/zona-tarifa.repository.port';

interface ZonaRow {
  id_zona: number;
  nombre_zona: string;
  tarifa_base: string | number;
}

export class ZonaTarifaRepositoryPostgres implements ZonaTarifaRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async findById(id_zona: number): Promise<ZonaTarifa | null> {
    const result = await this.pool.query<ZonaRow>('SELECT * FROM Zona_Tarifa WHERE id_zona = $1', [id_zona]);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async findAll(): Promise<ZonaTarifa[]> {
    const result = await this.pool.query<ZonaRow>('SELECT * FROM Zona_Tarifa ORDER BY tarifa_base, id_zona');
    return result.rows.map((r) => this.mapRow(r));
  }

  async updateTarifa(id_zona: number, tarifa_base: number): Promise<ZonaTarifa | null> {
    const result = await this.pool.query<ZonaRow>('UPDATE Zona_Tarifa SET tarifa_base = $1 WHERE id_zona = $2 RETURNING *', [
      tarifa_base,
      id_zona,
    ]);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  private mapRow(row: ZonaRow): ZonaTarifa {
    return { id_zona: row.id_zona, nombre_zona: row.nombre_zona, tarifa_base: Number(row.tarifa_base) };
  }
}
