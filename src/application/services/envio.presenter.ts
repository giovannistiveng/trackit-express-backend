import { DesgloseTarifa } from '../../domain/services/tarifas';
import { Envio, EnvioDetallado, gananciaConductor } from '../../domain/entities/shipment.entity';
import { Pago } from '../../domain/entities/pago.entity';
import { presentarPago } from './pagos.service';
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
  distancia_km?: number | null;
  duracion_min?: number | null;
  desglose?: DesgloseTarifa | null;
  notas?: string | null;
  motivo_cancelacion?: string | null;
  origen_coords?: { lat: number; lon: number } | null;
  destino_coords?: { lat: number; lon: number } | null;
  /** Lo que recibe el conductor por el servicio (tarifa menos la comisión de la plataforma). */
  ganancia_conductor?: number;
  ultimo_cambio_estado?: string;
  fecha_ultimo_cambio?: string;
  historial_estado?: { estado: string; fecha: string }[];
  calificado?: boolean;
  calificacion?: number | null;
  comentario?: string | null;
  conductor?: EnvioDetallado['conductor'];
  metodo_pago?: string;
  pago?: ReturnType<typeof presentarPago>;
  /** Solo para el cliente dueño: token del enlace público de seguimiento. */
  token_seguimiento?: string | null;
  destinatario_nombre?: string | null;
  destinatario_telefono?: string | null;
  fecha_programada?: string | null;
  ida_y_vuelta?: boolean;
  destino_visitado_en?: string | null;
  url_foto_recogida?: string | null;
  fecha_recogida?: string | null;
  paradas?: { id_parada?: number; orden: number; direccion: string; coords: { lat: number; lon: number }; notas?: string | null; completada_en: string | null }[];
  chat_no_leidos?: number;
}

export interface OpcionesPresentacion {
  /** El PIN solo se entrega al cliente dueño del envío (RN_HIS_001). */
  incluirPin: boolean;
  /** Vista del conductor: agrega su ganancia por el servicio. */
  vistaConductor?: boolean;
  historial?: HistorialEstadoRow[];
  calificacion?: number | null;
  conductor?: EnvioDetallado['conductor'];
  pago?: Pago | null;
  chatNoLeidos?: number;
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
    distancia_km: envio.distancia_km ?? null,
    duracion_min: envio.duracion_min ?? null,
    desglose: envio.desglose ?? null,
    notas: envio.notas ?? null,
    origen_coords: envio.origen_coords ?? null,
    destino_coords: envio.destino_coords ?? null,
    metodo_pago: envio.metodo_pago ?? 'efectivo',
    fecha_programada: envio.fecha_programada?.toISOString() ?? null,
    ida_y_vuelta: !!envio.ida_y_vuelta,
    destino_visitado_en: envio.destino_visitado_en?.toISOString() ?? null,
    url_foto_recogida: envio.url_foto_recogida ?? null,
    fecha_recogida: envio.fecha_recogida?.toISOString() ?? null,
  };
  if (envio.paradas) {
    salida.paradas = envio.paradas.map((p) => ({
      id_parada: p.id_parada,
      orden: p.orden,
      direccion: p.direccion,
      coords: p.coords,
      notas: p.notas ?? null,
      completada_en: p.completada_en?.toISOString() ?? null,
    }));
  }
  if (o.pago !== undefined) salida.pago = presentarPago(o.pago);
  if (o.chatNoLeidos !== undefined) salida.chat_no_leidos = o.chatNoLeidos;
  // Quien recibe: lo ven el cliente dueño y el conductor asignado
  if (o.incluirPin || (o.vistaConductor && envio.id_conductor)) {
    salida.destinatario_nombre = envio.destinatario_nombre ?? null;
    salida.destinatario_telefono = envio.destinatario_telefono ?? null;
  }
  if (o.incluirPin) salida.token_seguimiento = envio.token_seguimiento ?? null;
  if (envio.fecha_creacion) salida.fecha_creacion = envio.fecha_creacion.toISOString();
  if (envio.estado === 'Cancelado') salida.motivo_cancelacion = envio.motivo_cancelacion ?? null;
  if (o.vistaConductor) salida.ganancia_conductor = gananciaConductor(envio.tarifa);
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
    if ('comentario' in envio && envio.comentario) salida.comentario = envio.comentario;
  }
  const conductor = o.conductor !== undefined ? o.conductor : 'conductor' in envio ? envio.conductor : undefined;
  if (conductor) salida.conductor = conductor;
  return salida;
}
