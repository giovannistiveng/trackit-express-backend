import { Pool } from 'pg';
import { DocumentoConductor } from '../../../domain/entities/documento-conductor.entity';
import { DocumentoConductorRepositoryPort } from '../../../domain/repositories/documento-conductor.repository.port';

export class DocumentoConductorRepositoryPostgres implements DocumentoConductorRepositoryPort {
  constructor(private pool: Pool) {}

  async create(documento: Omit<DocumentoConductor, 'id'>): Promise<DocumentoConductor> {
    const query = `
      INSERT INTO Documento_Conductor (tipo_documento, url_archivo, id_conductor)
      VALUES ($1, $2, $3)
      RETURNING id_documento, tipo_documento, url_archivo, id_conductor, fecha_subida
    `;
    const values = [documento.tipo_documento, documento.url_archivo, documento.id_conductor];
    const result = await this.pool.query(query, values);
    const row = result.rows[0];
    return this.mapRow(row);
  }

  async findByConductor(id_conductor: number): Promise<DocumentoConductor[]> {
    const query = 'SELECT * FROM Documento_Conductor WHERE id_conductor = $1 ORDER BY fecha_subida DESC';
    const result = await this.pool.query(query, [id_conductor]);
    return result.rows.map(this.mapRow);
  }

  async findByIdAndConductor(id_documento: number, id_conductor: number): Promise<DocumentoConductor | null> {
    const query = 'SELECT * FROM Documento_Conductor WHERE id_documento = $1 AND id_conductor = $2';
    const result = await this.pool.query(query, [id_documento, id_conductor]);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  private mapRow(row: any): DocumentoConductor {
    return {
      id: row.id_documento,
      tipo_documento: row.tipo_documento,
      url_archivo: row.url_archivo,
      id_conductor: row.id_conductor,
      fecha_subida: row.fecha_subida,
    };
  }
}