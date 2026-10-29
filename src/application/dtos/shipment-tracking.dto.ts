export interface ShipmentTrackingDTO {
  id_envio: number;
  origen: string;
  destino: string;
  tipo_carga: string;
  tarifa: number;
  pin_seguridad?: string;
  estado: string;
  id_cliente: number;
  id_conductor?: number;
  id_zona: number;
  ultimo_cambio_estado: string;
  fecha_ultimo_cambio: string;
  historial_estado: { estado: string; fecha: string }[];
}
