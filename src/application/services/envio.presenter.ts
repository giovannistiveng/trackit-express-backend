import { Envio, EnvioDetallado } from '../../domain/entities/shipment.entity';
import { HistorialEstadoRow } from '../../domain/repositories/shipment.repository.port';

export interface EnvioApi {
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
  categoria?: string | null;
  fecha_creacion?: string;
  ultimo_cambio_estado?: string;
  fecha_ultimo_cambio?: string;
  historial_estado?: { estado: string; fecha: string }[];
  calificado?: boolean;
  calificacion?: number | null;
  conductor?: EnvioDetallado['conductor'];
}

export interface OpcionesPresentacion {
  /** El PIN solo se entrega al cliente dueño del envío (RN_HIS_001). */
  incluirPin: boolean;
  historial?: HistorialEstadoRow[];
  calificacion?: number | null;
  conductor?: EnvioDetallado['conductor'];
}

/** Convierte un envío del dominio al JSON público de la API. */
export function presentarEnvio(envio: Envio | EnvioDetallado, o: OpcionesPresentacion): EnvioApi {
  const salida: EnvioApi = {
    id_envio: envio.id_envio as number,
    origen: envio.origen,
    destino: envio.destino,
    tipo_carga: envio.tipo_carga,
    tarifa: envio.tarifa,
    estado: envio.estado ?? 'Pendiente',
    id_cliente: envio.id_cliente,
    id_conductor: envio.id_conductor,
    id_zona: envio.id_zona,
    categoria: envio.categoria ?? null,
  };
  if (envio.fecha_creacion) salida.fecha_creacion = envio.fecha_creacion.toISOString();
  if (o.incluirPin && envio.pin_seguridad) salida.pin_seguridad = envio.pin_seguridad;

  if (o.historial) {
    const ultimo = o.historial[0];
    salida.ultimo_cambio_estado = ultimo?.estado ?? 'Pendiente';
    salida.fecha_ultimo_cambio = (ultimo?.fecha_cambio ?? envio.fecha_creacion ?? new Date()).toISOString();
    salida.historial_estado = o.historial.map((h) => ({ estado: h.estado, fecha: h.fecha_cambio.toISOString() }));
  } else if ('fecha_ultimo_cambio' in envio && envio.fecha_ultimo_cambio) {
    salida.fecha_ultimo_cambio = envio.fecha_ultimo_cambio.toISOString();
  }

  const calificacion = o.calificacion !== undefined ? o.calificacion : 'calificacion' in envio ? envio.calificacion : undefined;
  if (calificacion !== undefined) {
    salida.calificado = calificacion !== null;
    salida.calificacion = calificacion;
  }
  const conductor = o.conductor !== undefined ? o.conductor : 'conductor' in envio ? envio.conductor : undefined;
  if (conductor) salida.conductor = conductor;
  return salida;
}
