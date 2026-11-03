import { MetodoPago } from './shipment.entity';

/**
 * Estados de un pago:
 * - Nequi: pendiente → aprobado | rechazado | expirado. Si se cancela ya pagado: reembolso_pendiente → reembolsado.
 * - Efectivo: por_cobrar → cobrado (al entregar). Si se cancela: anulado.
 */
export const ESTADOS_PAGO = [
  'pendiente',
  'aprobado',
  'rechazado',
  'expirado',
  'por_cobrar',
  'cobrado',
  'anulado',
  'reembolso_pendiente',
  'reembolsado',
] as const;
export type EstadoPago = (typeof ESTADOS_PAGO)[number];

export interface Pago {
  id_pago?: number;
  id_envio: number;
  metodo: MetodoPago;
  estado: EstadoPago;
  monto: number;
  /** Celular Nequi (10 dígitos). Se guarda para poder reembolsar. */
  telefono?: string | null;
  transaccion_id?: string | null;
  mensaje?: string | null;
  intentos?: number;
  creado?: Date;
  actualizado?: Date;
  aprobado_en?: Date | null;
  id_liquidacion?: number | null;
}

/** El envío se publica a los conductores cuando el pago está garantizado. */
export function pagoPermitePublicar(p: Pick<Pago, 'metodo' | 'estado'> | null | undefined): boolean {
  return !p || p.metodo === 'efectivo' || p.estado === 'aprobado';
}

/** Un cobro push de Nequi vence si el cliente no lo acepta en este tiempo. */
export const VIGENCIA_PAGO_NEQUI_MIN = 10;

export interface Liquidacion {
  id_liquidacion?: number;
  id_conductor: number;
  conductor_nombre?: string;
  desde: string;
  hasta: string;
  servicios: number;
  total_tarifas: number;
  ganancia_conductor: number;
  cobrado_efectivo: number;
  comision_efectivo: number;
  /** Positivo: la plataforma le paga al conductor. Negativo: el conductor le debe a la plataforma. */
  saldo: number;
  estado: 'pendiente' | 'pagada';
  referencia?: string | null;
  creada?: Date;
  pagada_en?: Date | null;
}

/** Servicio entregado que aún no entra en una liquidación. */
export interface MovimientoConductor {
  id_envio: number;
  fecha: Date;
  metodo: MetodoPago;
  tarifa: number;
  ganancia: number;
}
