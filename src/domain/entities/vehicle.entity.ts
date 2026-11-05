export const CATEGORIAS_VEHICULO = ['Moto Express', 'Motocarro', 'Camioneta'] as const;
export type VehicleCategory = (typeof CATEGORIAS_VEHICULO)[number];

export interface Vehicle {
  id?: number;
  placa: string;
  categoria: VehicleCategory;
  id_conductor: number;
  created_at?: Date;
}
