export interface CreateShipmentDTO {
  origen: string;
  destino: string;
  tipo_carga: string;
  id_cliente: number;
  id_zona: number;
  id_vehiculo?: number;
}