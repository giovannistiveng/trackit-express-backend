export interface CreateShipmentDTO {
  origen: string;
  destino: string;
  tipo_carga: string;
  id_cliente: number;
  id_zona: number;
  id_vehiculo?: number;
}

export interface ShipmentResponse {
  id_envio: number;
  origen: string;
  destino: string;
  tipo_carga: string;
  tarifa: number;
  pin_seguridad: string;
  estado: string;
  id_cliente: number;
  id_conductor?: number;
  id_zona: number;
}