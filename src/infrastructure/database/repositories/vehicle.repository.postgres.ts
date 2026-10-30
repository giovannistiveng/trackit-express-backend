import { Pool } from 'pg';
import { Vehicle, VehicleCategory } from '../../../domain/entities/vehicle.entity';
import { VehicleRepositoryPort } from '../../../domain/repositories/vehicle.repository.port';
import { ValidationError } from '../../../shared/errors';
import { esViolacionUnica } from '../pg-errors';

interface VehiculoRow {
  id_vehiculo: number;
  placa: string;
  categoria: VehicleCategory;
  id_conductor: number;
}

export class VehicleRepositoryPostgres implements VehicleRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(vehicle: Omit<Vehicle, 'id'>): Promise<Vehicle> {
    try {
      const result = await this.pool.query<VehiculoRow>(
        `INSERT INTO Vehiculo (placa, categoria, id_conductor) VALUES ($1, $2, $3)
         RETURNING id_vehiculo, placa, categoria, id_conductor`,
        [vehicle.placa, vehicle.categoria, vehicle.id_conductor],
      );
      return this.mapRow(result.rows[0]);
    } catch (error) {
      if (esViolacionUnica(error)) throw new ValidationError('La placa ya está registrada');
      throw error;
    }
  }

  async findByPlate(placa: string): Promise<Vehicle | null> {
    const result = await this.pool.query<VehiculoRow>('SELECT * FROM Vehiculo WHERE placa = $1', [placa]);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async findByDriverId(id_conductor: number): Promise<Vehicle[]> {
    const result = await this.pool.query<VehiculoRow>('SELECT * FROM Vehiculo WHERE id_conductor = $1 ORDER BY id_vehiculo', [id_conductor]);
    return result.rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: VehiculoRow): Vehicle {
    return { id: row.id_vehiculo, placa: row.placa, categoria: row.categoria, id_conductor: row.id_conductor };
  }
}
