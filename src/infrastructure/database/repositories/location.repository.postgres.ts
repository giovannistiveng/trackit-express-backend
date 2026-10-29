import { Pool } from 'pg';
import { Ubicacion } from '../../../domain/entities/ubicacion.entity';
import { LocationRepositoryPort } from '../../../domain/repositories/location.repository.port';

export class LocationRepositoryPostgres implements LocationRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(u: Ubicacion): Promise<void> {
    await this.pool.query(
      `INSERT INTO Ubicacion_Envio (id_envio, latitud, longitud, capturado_en) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id_envio, capturado_en) DO NOTHING`,
      [u.id_envio, u.lat, u.lon, u.capturado_en],
    );
  }

  async findLast(id_envio: number): Promise<Ubicacion | null> {
    const r = await this.pool.query<{ latitud: string; longitud: string; capturado_en: Date }>(
      `SELECT latitud, longitud, capturado_en FROM Ubicacion_Envio
       WHERE id_envio = $1 ORDER BY capturado_en DESC, id_ubicacion DESC LIMIT 1`,
      [id_envio],
    );
    const row = r.rows[0];
    return row ? { id_envio, lat: Number(row.latitud), lon: Number(row.longitud), capturado_en: new Date(row.capturado_en) } : null;
  }
}
