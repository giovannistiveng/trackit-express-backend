import { Pool } from 'pg';
import { DocumentoConductor, EstadoDocumento, TipoDocumento } from '../../../domain/entities/documento-conductor.entity';
import { DocumentoConductorRepositoryPort, RevisionDocumento } from '../../../domain/ports/documento-conductor.repository.port';

interface DocumentoRow {
  id_documento: number;
  tipo_documento: TipoDocumento;
  url_archivo: string;
  id_conductor: number;
  fecha_subida: Date;
  estado: EstadoDocumento;
  motivo_rechazo: string | null;
  fecha_vencimiento: Date | string | null;
  revisado_en: Date | null;
  aviso_vencimiento_en: Date | null;
}

/** Una columna DATE llega como texto AAAA-MM-DD (o Date): se guarda como medianoche UTC. */
function fecha(valor: Date | string | null): Date | null {
  if (!valor) return null;
  if (valor instanceof Date) return new Date(Date.UTC(valor.getFullYear(), valor.getMonth(), valor.getDate()));
  return new Date(`${valor.slice(0, 10)}T00:00:00Z`);
}

const aTextoFecha = (f: Date | null | undefined) => (f ? f.toISOString().slice(0, 10) : null);

export class DocumentoConductorRepositoryPostgres implements DocumentoConductorRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(d: Omit<DocumentoConductor, 'id'>): Promise<DocumentoConductor> {
    const result = await this.pool.query<DocumentoRow>(
      `INSERT INTO Documento_Conductor (tipo_documento, url_archivo, id_conductor, fecha_vencimiento)
       VALUES ($1, $2, $3, $4::date)
       RETURNING *`,
      [d.tipo_documento, d.url_archivo, d.id_conductor, aTextoFecha(d.fecha_vencimiento)],
    );
    return this.mapRow(result.rows[0]);
  }

  async findById(id: number): Promise<DocumentoConductor | null> {
    const r = await this.pool.query<DocumentoRow>('SELECT * FROM Documento_Conductor WHERE id_documento = $1', [id]);
    return r.rows[0] ? this.mapRow(r.rows[0]) : null;
  }

  async findByConductor(id_conductor: number): Promise<DocumentoConductor[]> {
    const result = await this.pool.query<DocumentoRow>(
      'SELECT * FROM Documento_Conductor WHERE id_conductor = $1 ORDER BY fecha_subida DESC, id_documento DESC',
      [id_conductor],
    );
    return result.rows.map((r) => this.mapRow(r));
  }

  async review(id: number, r: RevisionDocumento): Promise<void> {
    await this.pool.query(
      `UPDATE Documento_Conductor
       SET estado = $1, motivo_rechazo = $2, revisado_en = $3,
           fecha_vencimiento = COALESCE($4::date, fecha_vencimiento)
       WHERE id_documento = $5`,
      [r.estado, r.motivo_rechazo, r.revisado_en, aTextoFecha(r.fecha_vencimiento), id],
    );
  }

  async findVigilados(): Promise<DocumentoConductor[]> {
    const r = await this.pool.query<DocumentoRow>(
      `SELECT d.* FROM Documento_Conductor d
       JOIN Conductor c ON c.id_conductor = d.id_conductor
       WHERE c.estado_aprobacion = 'Aprobado' AND (d.fecha_vencimiento IS NOT NULL OR d.tipo_documento = 'Antecedentes')`,
    );
    return r.rows.map((row) => this.mapRow(row));
  }

  async markWarned(id: number, f: Date): Promise<void> {
    await this.pool.query('UPDATE Documento_Conductor SET aviso_vencimiento_en = $1 WHERE id_documento = $2', [f, id]);
  }

  private mapRow(row: DocumentoRow): DocumentoConductor {
    return {
      id: row.id_documento,
      tipo_documento: row.tipo_documento,
      url_archivo: row.url_archivo,
      id_conductor: row.id_conductor,
      fecha_subida: row.fecha_subida,
      estado: row.estado ?? 'Pendiente',
      motivo_rechazo: row.motivo_rechazo ?? null,
      fecha_vencimiento: fecha(row.fecha_vencimiento),
      revisado_en: row.revisado_en ?? null,
      aviso_vencimiento_en: row.aviso_vencimiento_en ?? null,
    };
  }
}
