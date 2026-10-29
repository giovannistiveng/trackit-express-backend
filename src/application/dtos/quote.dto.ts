export interface QuoteShipmentDTO {
  origen: string;
  destino: string;
  id_zona: number;
}

export interface QuoteResponse {
  id_envio: number;
  origen: string;
  destino: string;
  tipo_carga: string;
  tarifa: number;
  distancia_km: number;
  tiempo_estimado_minutos: number;
  costo_total: number;
}