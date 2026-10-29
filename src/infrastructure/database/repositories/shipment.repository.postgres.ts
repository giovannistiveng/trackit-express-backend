import { Pool } from 'pg';
import { Envio } from '../../../domain/entities/shipment.entity';
import { ShipmentRepositoryPort, HistorialEstadoRow } from '../../../domain/repositories/shipment.repository.port';
import { ValidationError } from '../../../shared/errors';

export class ShipmentRepositoryPostgres implements ShipmentRepositoryPort {
  constructor(private pool: Pool) {}

  // La tabla Envio no tiene columna "estado": el estado actual es el último
  // registro de Historial_Estado. Si no hay historial, se considera 'Pendiente'.
  private readonly selectWithEstado = `
    SELECT e.*,
      COALESCE(
        (SELECT h.estado FROM Historial_Estado h
         WHERE h.id_envio = e.id_envio
         ORDER BY h.fecha_cambio DESC, h.id_historial DESC
         LIMIT 1),
        'Pendiente'
      ) AS estado
    FROM Envio e
  `;

  async create(envio: Omit<Envio, 'id_envio'>): Promise<Envio> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const query = `
        INSERT INTO Envio (origen, destino, tipo_carga, tarifa, pin_seguridad, id_cliente, id_zona)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id_envio, origen, destino, tipo_carga, tarifa, pin_seguridad, id_cliente, id_conductor, id_zona
      `;
      const values = [
        envio.origen,
        envio.destino,
        envio.tipo_carga,
        envio.tarifa,
        envio.pin_seguridad,
        envio.id_cliente,
        envio.id_zona,
      ];
      const result = await client.query(query, values);
      const row = result.rows[0];

      // Registrar el estado inicial en el historial
      await client.query(
        'INSERT INTO Historial_Estado (estado, id_envio) VALUES ($1, $2)',
        ['Pendiente', row.id_envio]
      );

      await client.query('COMMIT');
      return this.mapRow({ ...row, estado: 'Pendiente' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(id_envio: number): Promise<Envio | null> {
    const query = `${this.selectWithEstado} WHERE e.id_envio = $1`;
    const result = await this.pool.query(query, [id_envio]);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  async findByClient(id_cliente: number): Promise<Envio[]> {
    const query = `${this.selectWithEstado} WHERE e.id_cliente = $1 ORDER BY e.id_envio DESC`;
    const result = await this.pool.query(query, [id_cliente]);
    return result.rows.map((row) => this.mapRow(row));
  }

  async findByDriver(id_conductor: number): Promise<Envio[]> {
    const query = `${this.selectWithEstado} WHERE e.id_conductor = $1 ORDER BY e.id_envio DESC`;
    const result = await this.pool.query(query, [id_conductor]);
    return result.rows.map((row) => this.mapRow(row));
  }

  async findAvailable(): Promise<Envio[]> {
    const query = `
      SELECT * FROM (${this.selectWithEstado}) AS envios
      WHERE envios.estado = $1 AND envios.id_conductor IS NULL
      ORDER BY envios.id_envio ASC
    `;
    const result = await this.pool.query(query, ['Pendiente']);
    return result.rows.map((row) => this.mapRow(row));
  }

  async updateStatus(id_envio: number, estado: string, id_conductor?: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Asignar conductor solo si el envío aún no tiene uno (evita doble asignación concurrente)
      if (id_conductor) {
        const update = await client.query(
          'UPDATE Envio SET id_conductor = $1 WHERE id_envio = $2 AND id_conductor IS NULL',
          [id_conductor, id_envio]
        );
        if (update.rowCount === 0) {
          throw new ValidationError('Este envío ya fue tomado por otro conductor');
        }
      }

      // Registrar cambio en historial
      await client.query(
        'INSERT INTO Historial_Estado (estado, id_envio) VALUES ($1, $2)',
        [estado, id_envio]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async conductorExists(id_conductor: number): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 FROM Conductor WHERE id_conductor = $1', [id_conductor]);
    return result.rows.length > 0;
  }

  async getStatusHistory(id_envio: number): Promise<HistorialEstadoRow[]> {
    const result = await this.pool.query(
      'SELECT estado, fecha_cambio FROM Historial_Estado WHERE id_envio = $1 ORDER BY fecha_cambio DESC, id_historial DESC',
      [id_envio]
    );
    return result.rows.map((row) => ({ estado: row.estado, fecha_cambio: new Date(row.fecha_cambio) }));
  }

  async registerDelivery(id_envio: number, url_foto: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO Evidencia_Entrega (url_foto, id_envio) VALUES ($1, $2)',
        [url_foto, id_envio]
      );
      await client.query(
        'INSERT INTO Historial_Estado (estado, id_envio) VALUES ($1, $2)',
        ['Entregado', id_envio]
      );
      await client.query('COMMIT');
    } catch (error: any) {
      await client.query('ROLLBACK');
      // 23505 = unique_violation (Evidencia_Entrega.id_envio es UNIQUE)
      if (error?.code === '23505') {
        throw new ValidationError('Este envío ya tiene una evidencia de entrega registrada');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findCalification(id_envio: number): Promise<number | null> {
    const result = await this.pool.query('SELECT puntuacion FROM Calificacion WHERE id_envio = $1', [id_envio]);
    if (result.rows.length === 0) return null;
    return Number(result.rows[0].puntuacion);
  }

  async saveCalification(id_envio: number, puntuacion: number): Promise<void> {
    try {
      await this.pool.query('INSERT INTO Calificacion (puntuacion, id_envio) VALUES ($1, $2)', [puntuacion, id_envio]);
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ValidationError('Este envío ya fue calificado');
      }
      throw error;
    }
  }

  private mapRow(row: any): Envio {
    return {
      id_envio: row.id_envio,
      origen: row.origen,
      destino: row.destino,
      tipo_carga: row.tipo_carga,
      tarifa: Number(row.tarifa),
      pin_seguridad: row.pin_seguridad,
      id_cliente: row.id_cliente,
      id_conductor: row.id_conductor ?? undefined,
      id_zona: row.id_zona,
      estado: row.estado,
    };
  }
}