import { Pool } from 'pg';
import { Vehicle } from '../../../domain/entities/vehicle.entity';
import { VehicleRepositoryPort } from '../../../domain/repositories/vehicle.repository.port';

export class VehicleRepositoryPostgres implements VehicleRepositoryPort {
  constructor(private pool: Pool) {}

  async create(vehicle: Omit<Vehicle, 'id'>): Promise<Vehicle> {
    const query = `
      INSERT INTO Vehiculo (placa, categoria, id_conductor)
      VALUES ($1, $2, $3)
      RETURNING id_vehiculo, placa, categoria, id_conductor
    `;
    const values = [vehicle.placa, vehicle.categoria, vehicle.id_conductor];
    const result = await this.pool.query(query, values);
    const row = result.rows[0];
    return this.mapRow(row);
  }

  async findByPlate(placa: string): Promise<Vehicle | null> {
    const query = 'SELECT * FROM Vehiculo WHERE placa = $1';
    const result = await this.pool.query(query, [placa]);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  async findByDriverId(id_conductor: number): Promise<Vehicle[]> {
    const query = 'SELECT * FROM Vehiculo WHERE id_conductor = $1';
    const result = await this.pool.query(query, [id_conductor]);
    return result.rows.map(this.mapRow);
  }

  async findConductorById(id_conductor: number): Promise<boolean> {
    const query = 'SELECT 1 FROM Conductor WHERE id_conductor = $1';
    const result = await this.pool.query(query, [id_conductor]);
    return result.rows.length > 0;
  }

  private mapRow(row: any): Vehicle {
    return {
      id: row.id_vehiculo,
      placa: row.placa,
      categoria: row.categoria,
      id_conductor: row.id_conductor,
    };
  }
}