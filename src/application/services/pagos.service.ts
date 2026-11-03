import { ANTICIPO_PROGRAMADO_MIN, COMISION_PLATAFORMA, Envio, MetodoPago } from '../../domain/entities/shipment.entity';
import { Pago, VIGENCIA_PAGO_NEQUI_MIN, pagoPermitePublicar } from '../../domain/entities/pago.entity';
import { DriverRepositoryPort } from '../../domain/repositories/driver.repository.port';
import { PagoRepositoryPort, PaymentGatewayPort } from '../../domain/repositories/platform.ports';
import { ShipmentRepositoryPort } from '../../domain/repositories/shipment.repository.port';
import { vehiculosQuePuedenLlevar } from '../../domain/services/tarifas';
import { ValidationError } from '../../shared/errors';
import { NotificationService } from './notification.service';

/** Celular Nequi colombiano: 10 dígitos que empiezan por 3. */
export function celularNequi(valor: unknown): string {
  const t = typeof valor === 'string' ? valor.replace(/[\s-]/g, '').replace(/^\+?57/, '') : '';
  if (!/^3\d{9}$/.test(t)) throw new ValidationError('Escribe el celular de Nequi: 10 dígitos que empiezan por 3');
  return t;
}

export function metodoPagoValido(valor: unknown): MetodoPago {
  if (valor === undefined || valor === null || valor === '') return 'efectivo';
  if (valor !== 'efectivo' && valor !== 'nequi') throw new ValidationError('El método de pago debe ser efectivo o nequi');
  return valor;
}

/** Datos del pago que se muestran en la API (el celular va enmascarado). */
export function presentarPago(p: Pago | null) {
  if (!p) return null;
  return {
    metodo: p.metodo,
    estado: p.estado,
    monto: p.monto,
    telefono: p.telefono ? `*** *** ${p.telefono.slice(-4)}` : null,
    mensaje: p.mensaje ?? null,
    actualizado: p.actualizado?.toISOString() ?? null,
    aprobado_en: p.aprobado_en?.toISOString() ?? null,
  };
}

/**
 * Publica un envío a los conductores cuando está listo: pago garantizado y, si es programado,
 * a menos de una hora de su hora. Avisa a los conductores libres que pueden llevarlo.
 */
export class PublicadorEnvios {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly notificaciones: NotificationService,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  /** true si el envío ya debe verse en el tablero. */
  visible(e: Envio, pago: Pago | null): boolean {
    if (!pagoPermitePublicar(pago)) return false;
    if (!e.fecha_programada) return true;
    return e.fecha_programada.getTime() - this.reloj().getTime() <= ANTICIPO_PROGRAMADO_MIN * 60_000;
  }

  async publicar(e: Envio, pago: Pago | null): Promise<void> {
    if (!this.visible(e, pago)) return;
    if (e.fecha_programada) await this.envios.markScheduledAnnounced(e.id_envio as number).catch(() => undefined);
    try {
      const usuarios = await this.drivers.usuariosDisponibles(vehiculosQuePuedenLlevar(e.categoria ?? null));
      const ganancia = Math.round(e.tarifa * (1 - COMISION_PLATAFORMA));
      const cuando = e.fecha_programada ? ` Programado para las ${horaCorta(e.fecha_programada)}.` : '';
      const pago = e.metodo_pago === 'nequi' ? ' Pagado con Nequi.' : ' Cobras en efectivo.';
      await Promise.all(
        usuarios.map((id_usuario) =>
          this.notificaciones.notificar({
            id_usuario,
            tipo: 'nuevo_servicio',
            titulo: 'Nuevo servicio disponible',
            mensaje: `Envío #${e.id_envio} hacia ${e.destino}. Ganas $ ${ganancia.toLocaleString('es-CO')}.${pago}${cuando}`,
            id_envio: e.id_envio,
          }),
        ),
      );
    } catch {
      // Los conductores igual lo verán en su tablero
    }
  }
}

/** "3:30 p. m." en hora de Colombia. */
export function horaCorta(f: Date): string {
  return f.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
}

/** Ciclo de vida del pago de un envío: cobro, aprobación, efectivo, cancelación y reembolso. */
export class PagosService {
  constructor(
    private readonly pagos: PagoRepositoryPort,
    private readonly pasarela: PaymentGatewayPort,
    private readonly envios: ShipmentRepositoryPort,
    private readonly publicador: PublicadorEnvios,
    private readonly notificaciones: NotificationService,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  /** Crea el pago del envío recién creado. Con Nequi envía el cobro al celular del cliente. */
  async iniciar(e: Envio, metodo: MetodoPago, telefono: string | null): Promise<Pago> {
    if (metodo === 'efectivo') {
      return this.pagos.create({ id_envio: e.id_envio as number, metodo, estado: 'por_cobrar', monto: e.tarifa });
    }
    const pago = await this.pagos.create({ id_envio: e.id_envio as number, metodo, estado: 'pendiente', monto: e.tarifa, telefono, intentos: 0 });
    return this.cobrarNequi(e, pago, telefono as string);
  }

  async cobrarNequi(e: Envio, pago: Pago, telefono: string): Promise<Pago> {
    try {
      const { transaccionId } = await this.pasarela.solicitarCobro({ telefono, monto: e.tarifa, referencia: `TrackIt envío ${e.id_envio}` });
      return (await this.pagos.update(e.id_envio as number, {
        metodo: 'nequi',
        estado: 'pendiente',
        telefono,
        transaccion_id: transaccionId,
        mensaje: 'Acepta el pago en la notificación de tu app Nequi',
        intentos: (pago.intentos ?? 0) + 1,
      })) as Pago;
    } catch (err) {
      return (await this.pagos.update(e.id_envio as number, {
        metodo: 'nequi',
        estado: 'rechazado',
        telefono,
        mensaje: err instanceof Error ? err.message.slice(0, 250) : 'Nequi no pudo procesar el cobro',
        intentos: (pago.intentos ?? 0) + 1,
      })) as Pago;
    }
  }

  /** Consulta a la pasarela un cobro pendiente y aplica el resultado. Devuelve el pago al día. */
  async actualizar(pago: Pago): Promise<Pago> {
    if (pago.metodo !== 'nequi' || pago.estado !== 'pendiente' || !pago.transaccion_id) return pago;
    let estado: Awaited<ReturnType<PaymentGatewayPort['consultarEstado']>>;
    try {
      estado = await this.pasarela.consultarEstado(pago.transaccion_id);
    } catch {
      return pago;
    }
    const vencido = this.reloj().getTime() - (pago.actualizado ?? pago.creado ?? this.reloj()).getTime() > VIGENCIA_PAGO_NEQUI_MIN * 60_000;
    if (estado.estado === 'pendiente' && !vencido) return pago;
    const e = await this.envios.findById(pago.id_envio);
    if (!e) return pago;

    if (estado.estado === 'aprobado') {
      // Si el cliente canceló mientras pagaba, se devuelve el dinero de inmediato
      if (e.estado === 'Cancelado') {
        await this.pagos.update(pago.id_envio, { estado: 'aprobado', aprobado_en: this.reloj() });
        return this.reembolsar({ ...pago, estado: 'aprobado' });
      }
      const p = (await this.pagos.update(pago.id_envio, { estado: 'aprobado', aprobado_en: this.reloj(), mensaje: 'Pago recibido' })) as Pago;
      await this.notificaciones.notificar({
        id_usuario: e.id_cliente,
        tipo: 'pago_aprobado',
        titulo: 'Pago recibido',
        mensaje: `Recibimos tu pago Nequi de $ ${Math.round(pago.monto).toLocaleString('es-CO')} por el envío #${e.id_envio}. Ya lo ven los conductores.`,
        id_envio: e.id_envio,
      });
      await this.publicador.publicar(e, p);
      return p;
    }
    const final = estado.estado === 'pendiente' ? 'expirado' : estado.estado;
    const mensaje =
      final === 'expirado'
        ? 'El cobro venció sin respuesta. Intenta de nuevo o paga en efectivo.'
        : (estado.mensaje ?? 'El pago fue rechazado en Nequi. Intenta de nuevo o paga en efectivo.');
    const p = (await this.pagos.update(pago.id_envio, { estado: final, mensaje })) as Pago;
    await this.notificaciones.notificar({
      id_usuario: e.id_cliente,
      tipo: 'pago_rechazado',
      titulo: final === 'expirado' ? 'El cobro de Nequi venció' : 'Pago no completado',
      mensaje: `Envío #${e.id_envio}: ${mensaje}`,
      id_envio: e.id_envio,
    });
    return p;
  }

  /** El conductor confirma que recibió el efectivo al entregar. */
  async cobrarEfectivo(id_envio: number): Promise<void> {
    await this.pagos.update(id_envio, { estado: 'cobrado' });
  }

  /** Al cancelar: anula el cobro o devuelve el dinero si ya estaba pagado con Nequi. */
  async alCancelar(id_envio: number): Promise<Pago | null> {
    const pago = await this.pagos.findByEnvio(id_envio);
    if (!pago) return null;
    if (pago.metodo === 'nequi' && pago.estado === 'aprobado') return this.reembolsar(pago);
    if (['pendiente', 'por_cobrar', 'rechazado', 'expirado'].includes(pago.estado)) {
      return this.pagos.update(id_envio, { estado: 'anulado', mensaje: 'Envío cancelado' });
    }
    return pago;
  }

  async reembolsar(pago: Pago): Promise<Pago> {
    try {
      await this.pasarela.reembolsar({ telefono: pago.telefono ?? '', monto: pago.monto, transaccionId: pago.transaccion_id ?? '' });
      return (await this.pagos.update(pago.id_envio, { estado: 'reembolsado', mensaje: 'Dinero devuelto a tu Nequi' })) as Pago;
    } catch (err) {
      return (await this.pagos.update(pago.id_envio, {
        estado: 'reembolso_pendiente',
        mensaje: `Reembolso pendiente: ${err instanceof Error ? err.message.slice(0, 200) : 'Nequi no respondió'}`,
      })) as Pago;
    }
  }
}
