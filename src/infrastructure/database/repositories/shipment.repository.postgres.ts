import { Pool } from 'pg';
import { Envio } from '../../../domain/entities/shipment.entity';
import { ShipmentRepositoryPort } from '../../../domain/repositories/shipment.repository.port';

export class ShipmentRepositoryPostgres implements ShipmentRepositoryPort {
  constructor(private pool: Pool) {}

  async create(envio: Omit<Envio, 'id_envio'>): Promise<Envio> {
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
    const result = await this.pool.query(query, values);
    const row = result.rows[0];
    return this.mapRow(row);
  }

  async findById(id_envio: number): Promise<Envio | null> {
    const query = 'SELECT * FROM Envio WHERE id_envio = $1';
    const result = await this.pool.query(query, [id_envio]);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  async findByClient(id_cliente: number): Promise<Envio[]> {
    const query = 'SELECT * FROM Envio WHERE id_cliente = $1 ORDER BY id_envio DESC';
    const result = await this.pool.query(query, [id_cliente]);
    return result.rows.map(this.mapRow);
  }

  async findByDriver(id_conductor: number): Promise<Envio[]> {
    const query = 'SELECT * FROM Envio WHERE id_conductor = $1 ORDER BY id_envio DESC';
    const result = await this.pool.query(query, [id_conductor]);
    return result.rows.map(this.mapRow);
  }

  async findAvailable(): Promise<Envio[]> {
    const query = 'SELECT * FROM Envio WHERE estado = $1 AND id_conductor IS NULL ORDER BY id_envio ASC';
    const result = await this.pool.query(query, ['Pendiente']);
    return result.rows.map(this.mapRow);
  }

  async updateStatus(id_envio: number, estado: string, id_conductor?: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Registrar cambio en historial
      await client.query(
        'INSERT INTO Historial_Estado (estado, id_envio) VALUES ($1, $2)',
        [estado, id_envio]
      );

      // Actualizar estado y conductor del envío
      if (id_conductor) {
        await client.query(
          'UPDATE Envio SET id_conductor = $1 WHERE id_envio = $2',
          [id_conductor, id_envio]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private mapRow(row: any): Envio {
    return {
      id_envio: row.id_envio,
      origen: row.origen,
      destino: row.destino,
      tipo_carga: row.tipo_carga,
      tarifa: row.tarifa,
      pin_seguridad: row.pin_seguridad,
      id_cliente: row.id_cliente,
      id_conductor: row.id_conductor,
      id_zona: row.id_zona,
    };
  }
}