import { Vehicle } from '../entities/vehicle.entity';

export interface VehicleRepositoryPort {
  create(vehicle: Omit<Vehicle, 'id'>): Promise<Vehicle>;
  findByPlate(placa: string): Promise<Vehicle | null>;
  findByDriverId(id_conductor: number): Promise<Vehicle[]>;
}
