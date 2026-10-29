export type TipoCarga = 'Documentos' | 'Mercancía General' | 'Carga Pesada' | 'Acarreo';

export type EstadoEnvio = 'Pendiente' | 'Asignado' | 'En Ruta' | 'Entregado';

export interface Envio {
  id_envio?: number;
  origen: string;
  destino: string;
  tipo_carga: string;
  tarifa: number;
  pin_seguridad?: string;
  id_cliente: number;
  id_conductor?: number;
  id_zona: number;
  // Estado actual: se obtiene del último registro en Historial_Estado
  estado?: EstadoEnvio;
}