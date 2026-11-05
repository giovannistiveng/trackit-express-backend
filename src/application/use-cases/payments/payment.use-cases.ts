import { Actor, ROLES } from '../../../domain/entities/actor.entity';
import { ESTADOS_PAGO, EstadoPago, Liquidacion, Pago } from '../../../domain/entities/pago.entity';
import { Envio } from '../../../domain/entities/shipment.entity';
import { DriverRepositoryPort } from '../../../domain/ports/driver.repository.port';
import { LiquidacionRepositoryPort, PagoRepositoryPort } from '../../../domain/ports/platform.ports';
import { ShipmentRepositoryPort } from '../../../domain/ports/shipment.repository.port';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors';
import { conductorDelActor, envioExistente, exigirEstado, exigirRol } from '../../services/access';
import { AuditService } from '../../services/audit.service';
import { NotificationService } from '../../services/notification.service';
import { PagosService, PublicadorEnvios, celularNequi, presentarPago } from '../../services/pagos.service';
import { idValido, textoValido } from '../../validation';

/** Pago de un envío visible para el cliente dueño, el conductor asignado o el administrador. */
async function envioConPago(envios: ShipmentRepositoryPort, drivers: DriverRepositoryPort, actor: Actor, id: unknown): Promise<Envio> {
  const envio = await envioExistente(envios, id);
  if (actor.role === ROLES.ADMIN) return envio;
  if (actor.role === ROLES.CLIENTE && envio.id_cliente === actor.userId) return envio;
  if (actor.role === ROLES.CONDUCTOR) {
    const c = await drivers.findByUserId(actor.userId);
    if (c && c.id_conductor === envio.id_conductor) return envio;
  }
  throw new ForbiddenError('No tienes acceso a este envío');
}

async function pagoDe(pagos: PagoRepositoryPort, id_envio: number): Promise<Pago> {
  const p = await pagos.findByEnvio(id_envio);
  if (!p) throw new NotFoundError('Este envío no tiene un pago registrado');
  return p;
}

/** Estado del pago. Si es un cobro Nequi pendiente, consulta a Nequi en el momento. */
export class GetShipmentPaymentUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly pagos: PagoRepositoryPort,
    private readonly servicio: PagosService,
  ) {}

  async execute(actor: Actor, id: unknown) {
    const envio = await envioConPago(this.envios, this.drivers, actor, id);
    const pago = await this.servicio.actualizar(await pagoDe(this.pagos, envio.id_envio as number));
    return presentarPago(pago);
  }
}

/** Vuelve a enviar el cobro a Nequi (rechazado, vencido o para cambiar de celular). */
export class RetryNequiPaymentUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly pagos: PagoRepositoryPort,
    private readonly servicio: PagosService,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, id: unknown, input: { telefono?: unknown }) {
    exigirRol(actor, ROLES.CLIENTE);
    const envio = await envioExistente(this.envios, id);
    if (envio.id_cliente !== actor.userId) throw new ForbiddenError('Solo puedes pagar tus propios envíos');
    exigirEstado(envio, ['Pendiente'], 'Este envío ya no admite cambios en el pago');
    const pago = await pagoDe(this.pagos, envio.id_envio as number);
    if (pago.estado === 'aprobado') throw new ValidationError('Este envío ya está pagado');
    if ((pago.intentos ?? 0) >= 5) throw new ValidationError('Alcanzaste el máximo de intentos con Nequi. Paga en efectivo o crea el envío de nuevo');
    const telefono = celularNequi(input.telefono ?? pago.telefono);
    const p = await this.servicio.cobrarNequi({ ...envio, metodo_pago: 'nequi' }, pago, telefono);
    await this.audit.registrar(actor, { accion: 'Cobro Nequi reenviado', entidad: 'Envío', idEntidad: envio.id_envio });
    return presentarPago(p);
  }
}

/** El cliente prefiere pagar en efectivo: el envío se publica de inmediato. */
export class SwitchToCashUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly pagos: PagoRepositoryPort,
    private readonly publicador: PublicadorEnvios,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, id: unknown) {
    exigirRol(actor, ROLES.CLIENTE);
    const envio = await envioExistente(this.envios, id);
    if (envio.id_cliente !== actor.userId) throw new ForbiddenError('Solo puedes pagar tus propios envíos');
    exigirEstado(envio, ['Pendiente'], 'Este envío ya no admite cambios en el pago');
    const pago = await pagoDe(this.pagos, envio.id_envio as number);
    if (pago.estado === 'aprobado') throw new ValidationError('Este envío ya está pagado con Nequi');
    if (pago.metodo === 'efectivo') return presentarPago(pago);
    const p = await this.pagos.update(envio.id_envio as number, { metodo: 'efectivo', estado: 'por_cobrar', mensaje: 'Pagas en efectivo al conductor', transaccion_id: null });
    await this.audit.registrar(actor, { accion: 'Pago cambiado a efectivo', entidad: 'Envío', idEntidad: envio.id_envio });
    await this.publicador.publicar({ ...envio, metodo_pago: 'efectivo' }, p);
    return presentarPago(p);
  }
}

/** Trabajo programado: consulta los cobros Nequi pendientes y aplica su resultado. */
export class ProcessPendingPaymentsUseCase {
  constructor(
    private readonly pagos: PagoRepositoryPort,
    private readonly servicio: PagosService,
  ) {}

  async execute(): Promise<number> {
    const pendientes = await this.pagos.findPendientesNequi(50);
    let cambios = 0;
    for (const p of pendientes) {
      const nuevo = await this.servicio.actualizar(p);
      if (nuevo.estado !== p.estado) cambios++;
    }
    return cambios;
  }
}

/** Lunes de la semana de `f` (las semanas de liquidación van de lunes a domingo). */
export function lunesDe(f: Date): Date {
  const d = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate()));
  const dia = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dia);
  return d;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Fecha de hoy en Colombia (UTC−5), como medianoche UTC de ese día. */
export function hoyColombia(ahora: Date): Date {
  const col = new Date(ahora.getTime() - 5 * 3600_000);
  return new Date(Date.UTC(col.getUTCFullYear(), col.getUTCMonth(), col.getUTCDate()));
}

/**
 * Liquidación semanal: por cada conductor, suma lo que ganó con Nequi (se lo debe la plataforma)
 * y resta la comisión de lo que cobró en efectivo (se la debe a la plataforma). Por defecto cierra
 * la última semana completa (lunes a domingo). Es idempotente.
 */
export class GenerateSettlementsUseCase {
  constructor(
    private readonly liquidaciones: LiquidacionRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly notificaciones: NotificationService,
    private readonly audit: AuditService,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async execute(actor: Actor | null, input: { hasta?: unknown } = {}): Promise<Liquidacion[]> {
    if (actor) exigirRol(actor, ROLES.ADMIN);
    const hasta = fechaDeCorte(input.hasta, hoyColombia(this.reloj()));
    const desde = new Date(hasta.getTime() - 6 * 86_400_000);
    const creadas = await this.liquidaciones.generar(iso(desde), iso(hasta));
    for (const l of creadas) {
      const c = await this.drivers.findById(l.id_conductor);
      if (!c) continue;
      await this.notificaciones.notificar({ id_usuario: c.id_usuario, tipo: 'liquidacion', titulo: 'Liquidación semanal', mensaje: textoLiquidacion(l) });
    }
    if (actor && creadas.length > 0) {
      await this.audit.registrar(actor, { accion: 'Liquidaciones generadas', entidad: 'Liquidación', detalle: `${creadas.length} del ${iso(desde)} al ${iso(hasta)}` });
    }
    return creadas;
  }
}

/** Fecha de corte (domingo de la semana a liquidar): la indicada o el domingo anterior a hoy. */
function fechaDeCorte(valor: unknown, hoy: Date): Date {
  if (valor === undefined || valor === null || valor === '') return new Date(lunesDe(hoy).getTime() - 86_400_000);
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new ValidationError('La fecha de corte debe tener el formato AAAA-MM-DD');
  const hasta = new Date(`${valor}T00:00:00Z`);
  if (hasta.getTime() > hoy.getTime()) throw new ValidationError('La fecha de corte no puede ser futura');
  return hasta;
}

const pesos = (n: number) => `$ ${Math.round(n).toLocaleString('es-CO')}`;

function textoLiquidacion(l: Liquidacion): string {
  const periodo = `del ${l.desde} al ${l.hasta}`;
  if (l.saldo > 0) return `Te pagaremos ${pesos(l.saldo)} por tus ${l.servicios} servicios ${periodo}.`;
  if (l.saldo < 0) return `Debes ${pesos(-l.saldo)} de comisión por los cobros en efectivo ${periodo}.`;
  return `Tus ${l.servicios} servicios ${periodo} quedaron saldados.`;
}

export class ListSettlementsUseCase {
  constructor(private readonly liquidaciones: LiquidacionRepositoryPort) {}

  async execute(actor: Actor, q: Record<string, unknown>) {
    exigirRol(actor, ROLES.ADMIN);
    const estado = q['estado'] === 'pendiente' || q['estado'] === 'pagada' ? q['estado'] : undefined;
    const pagina = Math.max(1, Number(q['pagina']) || 1);
    const tamano = Math.min(50, Math.max(1, Number(q['tamano']) || 20));
    const r = await this.liquidaciones.list({ estado, pagina, tamano });
    return { ...r, pagina, tamano };
  }
}

/** El administrador registra que pagó (o cobró) una liquidación, con la referencia del movimiento. */
export class PaySettlementUseCase {
  constructor(
    private readonly liquidaciones: LiquidacionRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly notificaciones: NotificationService,
    private readonly audit: AuditService,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async execute(actor: Actor, idCrudo: unknown, input: { referencia?: unknown }) {
    exigirRol(actor, ROLES.ADMIN);
    const id = idValido(idCrudo, 'id de la liquidación');
    const referencia = textoValido(input.referencia, 'referencia', 3, 100);
    const actual = await this.liquidaciones.findById(id);
    if (!actual) throw new NotFoundError(`No existe la liquidación ${id}`);
    if (actual.estado === 'pagada') throw new ValidationError('Esta liquidación ya está pagada');
    const l = (await this.liquidaciones.marcarPagada(id, referencia, this.reloj())) as Liquidacion;
    await this.audit.registrar(actor, { accion: 'Liquidación pagada', entidad: 'Liquidación', idEntidad: id, detalle: `${l.saldo} COP · ${referencia}` });
    const c = await this.drivers.findById(l.id_conductor);
    if (c) {
      await this.notificaciones.notificar({
        id_usuario: c.id_usuario,
        tipo: 'liquidacion',
        titulo: l.saldo >= 0 ? 'Te pagamos tu liquidación' : 'Registramos tu pago de comisión',
        mensaje: `Liquidación del ${l.desde} al ${l.hasta}: $ ${Math.round(Math.abs(l.saldo)).toLocaleString('es-CO')} · referencia ${referencia}.`,
      });
    }
    return l;
  }
}

/** Billetera del conductor: lo pendiente por liquidar y sus liquidaciones. */
export class DriverWalletUseCase {
  constructor(
    private readonly drivers: DriverRepositoryPort,
    private readonly liquidaciones: LiquidacionRepositoryPort,
  ) {}

  async execute(actor: Actor) {
    const c = await conductorDelActor(this.drivers, actor);
    const [movimientos, historial] = await Promise.all([
      this.liquidaciones.movimientosPendientes(c.id_conductor),
      this.liquidaciones.list({ id_conductor: c.id_conductor, pagina: 1, tamano: 12 }),
    ]);
    const nequi = movimientos.filter((m) => m.metodo === 'nequi');
    const efectivo = movimientos.filter((m) => m.metodo === 'efectivo');
    const porPagarte = nequi.reduce((a, m) => a + m.ganancia, 0);
    const comision = efectivo.reduce((a, m) => a + (m.tarifa - m.ganancia), 0);
    return {
      pendiente: {
        servicios: movimientos.length,
        ganancia_nequi: porPagarte,
        cobrado_efectivo: efectivo.reduce((a, m) => a + m.tarifa, 0),
        comision_efectivo: comision,
        saldo: porPagarte - comision,
      },
      movimientos: movimientos.slice(0, 30).map((m) => ({ ...m, fecha: m.fecha.toISOString() })),
      liquidaciones: historial.items,
    };
  }
}

/** Pagos de la plataforma con filtros (administración). */
export class ListPaymentsAdminUseCase {
  constructor(private readonly pagos: PagoRepositoryPort) {}

  async execute(actor: Actor, q: Record<string, unknown>) {
    exigirRol(actor, ROLES.ADMIN);
    const metodo = q['metodo'] === 'nequi' || q['metodo'] === 'efectivo' ? (q['metodo'] as string) : undefined;
    const estado = (ESTADOS_PAGO as readonly string[]).includes(String(q['estado'])) ? (q['estado'] as EstadoPago) : undefined;
    const pagina = Math.max(1, Number(q['pagina']) || 1);
    const tamano = Math.min(50, Math.max(1, Number(q['tamano']) || 20));
    const r = await this.pagos.search({ metodo, estado, pagina, tamano });
    return {
      total: r.total,
      pagina,
      tamano,
      items: r.items.map((p) => ({ id_envio: p.id_envio, cliente_nombre: p.cliente_nombre, origen: p.origen, destino: p.destino, ...presentarPago(p) })),
    };
  }
}

/** Reintenta un reembolso Nequi que quedó pendiente. */
export class RetryRefundUseCase {
  constructor(
    private readonly pagos: PagoRepositoryPort,
    private readonly servicio: PagosService,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, idEnvio: unknown) {
    exigirRol(actor, ROLES.ADMIN);
    const id = idValido(idEnvio, 'id del envío');
    const pago = await pagoDe(this.pagos, id);
    if (pago.estado !== 'reembolso_pendiente') throw new ValidationError('Este pago no tiene un reembolso pendiente');
    const p = await this.servicio.reembolsar(pago);
    await this.audit.registrar(actor, { accion: 'Reembolso reintentado', entidad: 'Envío', idEntidad: id, detalle: p.estado });
    return presentarPago(p);
  }
}
