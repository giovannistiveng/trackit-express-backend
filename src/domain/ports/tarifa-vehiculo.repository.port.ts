import { TarifaVehiculo } from '../entities/tarifa-vehiculo.entity';
import { VehicleCategory } from '../entities/vehicle.entity';

export interface TarifaVehiculoRepositoryPort {
  findAll(): Promise<TarifaVehiculo[]>;
  update(categoria: VehicleCategory, cambios: Omit<TarifaVehiculo, 'categoria'>): Promise<TarifaVehiculo | null>;
}
