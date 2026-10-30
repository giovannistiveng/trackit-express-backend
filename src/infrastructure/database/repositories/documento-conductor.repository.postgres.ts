import { Pool } from 'pg';
import { DocumentoConductor, TipoDocumento } from '../../../domain/entities/documento-conductor.entity';
import { DocumentoConductorRepositoryPort } from '../../../domain/repositories/documento-conductor.repository.port';

interface DocumentoRow {
  id_documento: number;
  tipo_documento: TipoDocumento;
  url_archivo: string;
  id_conductor: number;
  fecha_subida: Date;
}

export class DocumentoConductorRepositoryPostgres implements DocumentoConductorRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(documento: Omit<DocumentoConductor, 'id'>): Promise<DocumentoConductor> {
    const result = await this.pool.query<DocumentoRow>(
      `INSERT INTO Documento_Conductor (tipo_documento, url_archivo, id_conductor)
       VALUES ($1, $2, $3)
       RETURNING id_documento, tipo_documento, url_archivo, id_conductor, fecha_subida`,
      [documento.tipo_documento, documento.url_archivo, documento.id_conductor],
    );
    return this.mapRow(result.rows[0]);
  }

  async findByConductor(id_conductor: number): Promise<DocumentoConductor[]> {
    const result = await this.pool.query<DocumentoRow>(
      'SELECT * FROM Documento_Conductor WHERE id_conductor = $1 ORDER BY fecha_subida DESC',
      [id_conductor],
    );
    return result.rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: DocumentoRow): DocumentoConductor {
    return {
      id: row.id_documento,
      tipo_documento: row.tipo_documento,
      url_archivo: row.url_archivo,
      id_conductor: row.id_conductor,
      fecha_subida: row.fecha_subida,
    };
  }
}
