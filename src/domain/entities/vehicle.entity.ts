export type VehicleCategory = 'Moto Express' | 'Motocarro' | 'Camioneta';

export interface Vehicle {
  id?: number;
  placa: string;
  categoria: VehicleCategory;
  id_conductor: number;
  created_at?: Date;
}