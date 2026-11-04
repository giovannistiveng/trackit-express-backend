import { Pool } from 'pg';
import { ZonaTarifa } from '../../../domain/entities/zona-tarifa.entity';
import { DatosZona, ZonaTarifaRepositoryPort } from '../../../domain/ports/zona-tarifa.repository.port';
import { ValidationError } from '../../../shared/errors';
import { NumeroPg, esViolacionUnica } from '../pg-utils';

interface ZonaRow {
  id_zona: number;
  nombre_zona: string;
  tarifa_base: string | number;
  centro_lat?: NumeroPg;
  centro_lon?: NumeroPg;
  radio_km?: NumeroPg;
  activa?: boolean | null;
  descripcion?: string | null;
}

const COLUMNAS: Record<keyof DatosZona, string[]> = {
  nombre_zona: ['nombre_zona'],
  tarifa_base: ['tarifa_base'],
  centro: ['centro_lat', 'centro_lon'],
  radio_km: ['radio_km'],
  activa: ['activa'],
  descripcion: ['descripcion'],
};

function valores(campo: keyof DatosZona, z: Partial<DatosZona>): unknown[] {
  if (campo === 'centro') return [z.centro?.lat ?? null, z.centro?.lon ?? null];
  return [z[campo] ?? null];
}

export class ZonaTarifaRepositoryPostgres implements ZonaTarifaRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async findById(id_zona: number): Promise<ZonaTarifa | null> {
    const result = await this.pool.query<ZonaRow>('SELECT * FROM Zona_Tarifa WHERE id_zona = $1', [id_zona]);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async findAll(incluirInactivas = false): Promise<ZonaTarifa[]> {
    const result = await this.pool.query<ZonaRow>(
      `SELECT * FROM Zona_Tarifa WHERE eliminada = FALSE AND ($1::boolean OR activa) ORDER BY tarifa_base, radio_km, id_zona`,
      [incluirInactivas],
    );
    return result.rows.map((r) => this.mapRow(r));
  }

  async updateTarifa(id_zona: number, tarifa_base: number): Promise<ZonaTarifa | null> {
    return this.update(id_zona, { tarifa_base });
  }

  async create(zona: DatosZona): Promise<ZonaTarifa> {
    try {
      const result = await this.pool.query<ZonaRow>(
        `INSERT INTO Zona_Tarifa (nombre_zona, tarifa_base, centro_lat, centro_lon, radio_km, activa, descripcion)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          zona.nombre_zona,
          zona.tarifa_base,
          zona.centro?.lat ?? null,
          zona.centro?.lon ?? null,
          zona.radio_km ?? 3,
          zona.activa ?? true,
          zona.descripcion ?? null,
        ],
      );
      return this.mapRow(result.rows[0]);
    } catch (e) {
      if (esViolacionUnica(e)) throw new ValidationError('Ya existe una zona con ese nombre');
      throw e;
    }
  }

  async update(id_zona: number, cambios: Partial<DatosZona>): Promise<ZonaTarifa | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const campo of Object.keys(COLUMNAS) as (keyof DatosZona)[]) {
      if (!(campo in cambios)) continue;
      const vals = valores(campo, cambios);
      COLUMNAS[campo].forEach((col, i) => {
        params.push(vals[i]);
        sets.push(`${col} = $${params.length}`);
      });
    }
    if (sets.length === 0) return this.findById(id_zona);
    params.push(id_zona);
    try {
      const result = await this.pool.query<ZonaRow>(
        `UPDATE Zona_Tarifa SET ${sets.join(', ')} WHERE id_zona = $${params.length} RETURNING *`,
        params,
      );
      return result.rows[0] ? this.mapRow(result.rows[0]) : null;
    } catch (e) {
      if (esViolacionUnica(e)) throw new ValidationError('Ya existe una zona con ese nombre');
      throw e;
    }
  }

  async remove(id_zona: number): Promise<'borrada' | 'archivada' | null> {
    const usada = await this.pool.query('SELECT 1 FROM Envio WHERE id_zona = $1 LIMIT 1', [id_zona]);
    if (usada.rows.length > 0) {
      // Hay envíos con esta zona: se oculta en todas partes pero se conserva para el historial
      const r = await this.pool.query(
        `UPDATE Zona_Tarifa SET eliminada = TRUE, activa = FALSE,
                nombre_zona = LEFT(nombre_zona, 80) || ' (eliminada ' || id_zona || ')'
         WHERE id_zona = $1 AND eliminada = FALSE`,
        [id_zona],
      );
      return (r.rowCount ?? 0) > 0 ? 'archivada' : null;
    }
    const r = await this.pool.query('DELETE FROM Zona_Tarifa WHERE id_zona = $1', [id_zona]);
    return (r.rowCount ?? 0) > 0 ? 'borrada' : null;
  }

  private mapRow(row: ZonaRow): ZonaTarifa {
    const tieneCentro = row.centro_lat !== null && row.centro_lat !== undefined && row.centro_lon !== null && row.centro_lon !== undefined;
    return {
      id_zona: row.id_zona,
      nombre_zona: row.nombre_zona,
      tarifa_base: Number(row.tarifa_base),
      centro: tieneCentro ? { lat: Number(row.centro_lat), lon: Number(row.centro_lon) } : null,
      radio_km: row.radio_km === null || row.radio_km === undefined ? 3 : Number(row.radio_km),
      activa: row.activa ?? true,
      descripcion: row.descripcion ?? null,
    };
  }
}
