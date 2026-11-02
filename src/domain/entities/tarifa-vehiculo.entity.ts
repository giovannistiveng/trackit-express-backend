import { VehicleCategory } from './vehicle.entity';

/** Precio de un vehículo: banderazo + km × por_km + minutos × por_minuto, nunca menos del mínimo. */
export interface TarifaVehiculo {
  categoria: VehicleCategory;
  banderazo: number;
  por_km: number;
  por_minuto: number;
  minimo: number;
}
