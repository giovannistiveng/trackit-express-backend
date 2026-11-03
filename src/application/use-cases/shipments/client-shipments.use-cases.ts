import { randomBytes } from 'crypto';
import { Actor, ROLES } from '../../../domain/entities/actor.entity';
import { ESTADOS_ACTIVOS_CLIENTE, ESTADOS_ENVIO, EstadoEnvio } from '../../../domain/entities/shipment.entity';
import { coordenadasValidas } from '../../../domain/services/geo';
import { ChatRepositoryPort, PagoRepositoryPort, ParadaRepositoryPort } from '../../../domain/repositories/platform.ports';
import { DriverRepositoryPort } from '../../../domain/repositories/driver.repository.port';
import { DetallesEditables, ShipmentRepositoryPort } from '../../../domain/repositories/shipment.repository.port';
import { VehicleRepositoryPort } from '../../../domain/repositories/vehicle.repository.port';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors';
import { AuditService } from '../../services/audit.service';
import { NotificationService } from '../../services/notification.service';
import { EnvioApi, presentarEnvio } from '../../services/envio.presenter';
import { envioExistente, exigirEstado, exigirMismoId, exigirRol } from '../../services/access';
import { telefonoOpcional, textoOpcional, textoValido } from '../../validation';
import { Cotizador, SolicitudRuta } from '../../services/cotizador';
import { PagosService, PublicadorEnvios, celularNequi, metodoPagoValido } from '../../services/pagos.service';
import { GetTrackingUseCase } from './driver-shipments.use-cases';

export interface CreateShipmentInput extends SolicitudRuta {
  tipo_carga: unknown;
  notas?: unknown;
  id_cliente?: unknown;
  metodo_pago?: unknown;
  telefono_nequi?: unknown;
  destinatario_nombre?: unknown;
  destinatario_telefono?: unknown;
}

/** PIN de 4 dígitos (1000–9999). */
export function generarPin(aleatorio: () => number = Math.random): string {
  return Math.floor(1000 + aleatorio() * 9000).toString();
}

/** Token del enlace público de seguimiento: 24 bytes aleatorios (imposible de adivinar). */
export function generarTokenSeguimiento(): string {
  return randomBytes(24).toString('base64url');
}

/** CU-006: solicitud de envío. El cliente sale del token y la tarifa se recalcula en el servidor. */
export class CreateShipmentUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly cotizador: Cotizador,
    private readonly audit: AuditService,
    private readonly paradas: ParadaRepositoryPort,
    private readonly pagos: PagosService,
    private readonly publicador: PublicadorEnvios,
  ) {}

  async execute(actor: Actor, input: CreateShipmentInput): Promise<EnvioApi> {
    exigirRol(actor, ROLES.CLIENTE);
    exigirMismoId(input.id_cliente, actor.userId, 'id_cliente');
    const tipoCarga = textoValido(input.tipo_carga, 'tipo_carga', 1, 80);
    const notas = textoOpcional(input.notas, 'notas', 300);
    const metodo = metodoPagoValido(input.metodo_pago);
    const telefonoNequi = metodo === 'nequi' ? celularNequi(input.telefono_nequi) : null;
    const destinatarioNombre = textoOpcional(input.destinatario_nombre, 'destinatario_nombre', 120);
    const destinatarioTelefono = telefonoOpcional(input.destinatario_telefono);
    const c = await this.cotizador.cotizar(input);

    const envio = await this.envios.create({
      origen: c.origen,
      destino: c.destino,
      tipo_carga: tipoCarga,
      tarifa: c.desglose.total,
      pin_seguridad: generarPin(),
      id_cliente: actor.userId,
      id_zona: c.zona.id_zona as number,
      categoria: c.categoria,
      notas,
      distancia_km: Math.round(c.ruta.distancia_km * 100) / 100,
      duracion_min: c.minutos,
      desglose: c.desglose,
      origen_coords: coordenadasValidas(c.ruta.origen) ? c.ruta.origen : null,
      destino_coords: coordenadasValidas(c.ruta.destino) ? c.ruta.destino : null,
      metodo_pago: metodo,
      token_seguimiento: generarTokenSeguimiento(),
      destinatario_nombre: destinatarioNombre,
      destinatario_telefono: destinatarioTelefono,
      fecha_programada: c.fechaProgramada,
      ida_y_vuelta: c.idaYVuelta,
    });
    const id = envio.id_envio as number;
    if (c.paradas.length > 0) await this.paradas.saveAll(id, c.paradas);
    const pago = await this.pagos.iniciar(envio, metodo, telefonoNequi);
    await this.audit.registrar(actor, {
      accion: 'Envío creado',
      entidad: 'Envío',
      idEntidad: id,
      detalle: `${c.origen} → ${c.destino} · ${c.desglose.total} COP · ${metodo}${c.fechaProgramada ? ' · programado' : ''}`,
    });
    await this.publicador.publicar(envio, pago);
    return presentarEnvio({ ...envio, paradas: c.paradas }, { incluirPin: true, pago });
  }
}

export type FiltroEnviosCliente = 'activos' | 'historial' | EstadoEnvio;

/** E6-HU2: historial de envíos del cliente autenticado. */
export class ListClientShipmentsUseCase {
  constructor(private readonly envios: ShipmentRepositoryPort) {}

  async execute(actor: Actor, filtro?: unknown): Promise<EnvioApi[]> {
    exigirRol(actor, ROLES.CLIENTE);
    let estados: EstadoEnvio[] | undefined;
    if (filtro === 'activos') estados = ESTADOS_ACTIVOS_CLIENTE;
    else if (filtro === 'historial') estados = ['Entregado', 'Cancelado'];
    else if (typeof filtro === 'string' && filtro !== '') {
      if (!(ESTADOS_ENVIO as readonly string[]).includes(filtro)) throw new ValidationError('Filtro de estado inválido');
      estados = [filtro as EstadoEnvio];
    }
    const lista = await this.envios.findByClient(actor.userId, estados);
    return lista.map((e) => presentarEnvio(e, { incluirPin: true }));
  }
}

/**
 * CU-008: trazabilidad. Pueden verla el cliente dueño, el conductor asignado, el administrador
 * y un conductor aprobado mientras el envío está disponible. El PIN solo se entrega al dueño.
 */
export class TrackShipmentUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly vehicles: VehicleRepositoryPort,
    private readonly paradas: ParadaRepositoryPort,
    private readonly pagos: PagoRepositoryPort,
    private readonly chat: ChatRepositoryPort,
  ) {}

  async execute(actor: Actor, id: unknown): Promise<EnvioApi> {
    const envio = await envioExistente(this.envios, id);
    const esDueno = actor.role === ROLES.CLIENTE && envio.id_cliente === actor.userId;
    let permitido = esDueno || actor.role === ROLES.ADMIN;
    if (!permitido && actor.role === ROLES.CONDUCTOR) {
      const c = await this.drivers.findByUserId(actor.userId);
      const asignado = !!c && envio.id_conductor === c.id_conductor;
      const disponible = !!c && c.estado_aprobacion === 'Aprobado' && !envio.id_conductor && envio.estado === 'Pendiente';
      permitido = asignado || disponible;
    }
    if (!permitido) throw new ForbiddenError('No tienes acceso a este envío');

    const idEnvio = envio.id_envio as number;
    const [historial, calificacion, conductor, paradas, pago, chatNoLeidos] = await Promise.all([
      this.envios.getStatusHistory(idEnvio),
      this.envios.findCalification(idEnvio),
      this.resumenConductor(envio.id_conductor),
      this.paradas.findByEnvio(idEnvio),
      this.pagos.findByEnvio(idEnvio),
      this.chat.countUnread(idEnvio, actor.userId),
    ]);
    return presentarEnvio(
      { ...envio, paradas },
      { incluirPin: esDueno, historial, calificacion, conductor, pago, chatNoLeidos, vistaConductor: actor.role === ROLES.CONDUCTOR },
    );
  }

  private async resumenConductor(idConductor?: number) {
    if (!idConductor) return null;
    const [c, vehiculos, promedio] = await Promise.all([
      this.drivers.findById(idConductor),
      this.vehicles.findByDriverId(idConductor),
      this.drivers.averageRating(idConductor),
    ]);
    if (!c) return null;
    const v = vehiculos[0];
    return { nombre: c.nombre, placa: v?.placa ?? null, vehiculo: v?.categoria ?? null, calificacion_promedio: promedio };
  }
}

/** CU-010: calificación entera de 1 a 5 con comentario opcional, una sola vez, solo por el cliente dueño. */
export class RateShipmentUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly audit: AuditService,
    private readonly notificaciones: NotificationService,
  ) {}

  async execute(actor: Actor, id: unknown, ratingCrudo: unknown, comentarioCrudo?: unknown) {
    exigirRol(actor, ROLES.CLIENTE);
    const rating = Number(ratingCrudo);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ValidationError('La calificación debe estar entre 1 y 5 estrellas');
    }
    const comentario = textoOpcional(comentarioCrudo, 'comentario', 300);
    const envio = await envioExistente(this.envios, id);
    if (envio.id_cliente !== actor.userId) throw new ForbiddenError('Solo puedes calificar tus propios envíos');
    exigirEstado(envio, ['Entregado'], 'Solo se pueden calificar envíos que ya fueron entregados');
    if ((await this.envios.findCalification(envio.id_envio as number)) !== null) {
      throw new ValidationError('Este envío ya fue calificado');
    }
    await this.envios.saveCalification(envio.id_envio as number, rating, comentario);
    await this.audit.registrar(actor, { accion: 'Calificación', entidad: 'Envío', idEntidad: envio.id_envio, detalle: `${rating} estrellas` });
    const conductor = envio.id_conductor ? await this.drivers.findById(envio.id_conductor) : null;
    if (conductor) {
      await this.notificaciones.notificar({
        id_usuario: conductor.id_usuario,
        tipo: 'calificacion_recibida',
        titulo: `Recibiste ${rating} ${rating === 1 ? 'estrella' : 'estrellas'}`,
        mensaje: comentario ? `Servicio #${envio.id_envio}: "${comentario}"` : `El cliente calificó el servicio #${envio.id_envio}.`,
        id_envio: envio.id_envio,
      });
    }
    return { id_envio: envio.id_envio as number, calificacion: rating, comentario, estado: envio.estado };
  }
}

/**
 * Cancelación de un envío. El cliente dueño puede cancelar mientras está Pendiente
 * (nadie lo ha tomado). El administrador puede cancelar cualquiera que no haya terminado,
 * con motivo obligatorio. Se avisa a la otra parte.
 */
export class CancelShipmentUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly audit: AuditService,
    private readonly notificaciones: NotificationService,
    private readonly pagos: PagosService,
  ) {}

  async execute(actor: Actor, id: unknown, motivoCrudo?: unknown): Promise<EnvioApi> {
    exigirRol(actor, ROLES.CLIENTE, ROLES.ADMIN);
    const esAdmin = actor.role === ROLES.ADMIN;
    const motivo = esAdmin ? textoValido(motivoCrudo, 'motivo', 3, 255) : textoOpcional(motivoCrudo, 'motivo', 255);
    const envio = await envioExistente(this.envios, id);
    if (!esAdmin) {
      if (envio.id_cliente !== actor.userId) throw new ForbiddenError('Solo puedes cancelar tus propios envíos');
      exigirEstado(envio, ['Pendiente'], 'Solo puedes cancelar un envío mientras ningún conductor lo ha tomado');
    } else {
      exigirEstado(envio, ESTADOS_ACTIVOS_CLIENTE, `El envío ya está ${String(envio.estado).toLowerCase()} y no se puede cancelar`);
    }

    await this.envios.cancel(envio.id_envio as number, motivo);
    const pago = await this.pagos.alCancelar(envio.id_envio as number);
    await this.audit.registrar(actor, {
      accion: 'Envío cancelado',
      entidad: 'Envío',
      idEntidad: envio.id_envio,
      detalle: motivo ?? (esAdmin ? 'Por administración' : 'Por el cliente'),
    });

    const devolucion =
      pago?.estado === 'reembolsado' ? ' Te devolvimos el dinero a tu Nequi.' : pago?.estado === 'reembolso_pendiente' ? ' Procesaremos la devolución de tu pago Nequi.' : '';
    const aviso = `El envío #${envio.id_envio} (${envio.origen} → ${envio.destino}) fue cancelado${motivo ? `: ${motivo}` : '.'}`;
    if (esAdmin) {
      await this.notificaciones.notificar({ id_usuario: envio.id_cliente, tipo: 'envio_cancelado', titulo: 'Tu envío fue cancelado', mensaje: aviso + devolucion, id_envio: envio.id_envio });
    }
    const conductor = envio.id_conductor ? await this.drivers.findById(envio.id_conductor) : null;
    if (conductor) {
      await this.notificaciones.notificar({ id_usuario: conductor.id_usuario, tipo: 'envio_cancelado', titulo: 'Servicio cancelado', mensaje: aviso, id_envio: envio.id_envio });
    }
    const actualizado = await envioExistente(this.envios, envio.id_envio);
    return presentarEnvio(actualizado, { incluirPin: false, pago });
  }
}

/** El cliente corrige datos que no cambian el precio mientras ningún conductor tomó el envío. */
export class EditShipmentUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, id: unknown, input: Record<string, unknown>): Promise<EnvioApi> {
    exigirRol(actor, ROLES.CLIENTE);
    const envio = await envioExistente(this.envios, id);
    if (envio.id_cliente !== actor.userId) throw new ForbiddenError('Solo puedes editar tus propios envíos');
    exigirEstado(envio, ['Pendiente'], 'Solo puedes editar un envío mientras ningún conductor lo ha tomado');
    const cambios: DetallesEditables = {};
    if (input.tipo_carga !== undefined) cambios.tipo_carga = textoValido(input.tipo_carga, 'tipo_carga', 1, 80);
    if (input.notas !== undefined) cambios.notas = textoOpcional(input.notas, 'notas', 300);
    if (input.destinatario_nombre !== undefined) cambios.destinatario_nombre = textoOpcional(input.destinatario_nombre, 'destinatario_nombre', 120);
    if (input.destinatario_telefono !== undefined) cambios.destinatario_telefono = telefonoOpcional(input.destinatario_telefono);
    if (Object.keys(cambios).length === 0) throw new ValidationError('No hay cambios para guardar');
    await this.envios.updateDetalles(envio.id_envio as number, cambios);
    await this.audit.registrar(actor, { accion: 'Envío editado', entidad: 'Envío', idEntidad: envio.id_envio, detalle: Object.keys(cambios).join(', ') });
    return presentarEnvio(await envioExistente(this.envios, envio.id_envio), { incluirPin: true });
  }
}

export interface SeguimientoPublico {
  codigo: number;
  estado: string;
  origen: string;
  destino: string;
  destinatario: string | null;
  fecha_programada: string | null;
  ida_y_vuelta: boolean;
  historial: { estado: string; fecha: string }[];
  conductor: { nombre: string; vehiculo: string | null; placa: string | null } | null;
  paradas: { orden: number; direccion: string; completada: boolean }[];
  mapa: Awaited<ReturnType<GetTrackingUseCase['porEnvio']>> | null;
}

/**
 * Enlace público para quien recibe: estado, mapa en vivo y conductor, sin datos sensibles
 * (ni PIN, ni precio, ni datos del cliente). Solo el primer nombre del conductor.
 */
export class PublicTrackingUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly vehicles: VehicleRepositoryPort,
    private readonly paradas: ParadaRepositoryPort,
    private readonly mapa: GetTrackingUseCase,
  ) {}

  async execute(tokenCrudo: unknown): Promise<SeguimientoPublico> {
    const token = typeof tokenCrudo === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(tokenCrudo) ? tokenCrudo : '';
    const envio = token ? await this.envios.findByToken(token) : null;
    if (!envio) throw new NotFoundError('El enlace de seguimiento no existe o ya no está disponible');
    const id = envio.id_envio as number;
    const [historial, paradas] = await Promise.all([this.envios.getStatusHistory(id), this.paradas.findByEnvio(id)]);
    let conductor: SeguimientoPublico['conductor'] = null;
    if (envio.id_conductor) {
      const [c, vehiculos] = await Promise.all([this.drivers.findById(envio.id_conductor), this.vehicles.findByDriverId(envio.id_conductor)]);
      if (c) conductor = { nombre: c.nombre.split(' ')[0], vehiculo: vehiculos[0]?.categoria ?? null, placa: vehiculos[0]?.placa ?? null };
    }
    return {
      codigo: id,
      estado: envio.estado ?? 'Pendiente',
      origen: envio.origen,
      destino: envio.destino,
      destinatario: envio.destinatario_nombre?.split(' ')[0] ?? null,
      fecha_programada: envio.fecha_programada?.toISOString() ?? null,
      ida_y_vuelta: !!envio.ida_y_vuelta,
      historial: historial.map((h) => ({ estado: h.estado, fecha: h.fecha_cambio.toISOString() })),
      conductor,
      paradas: paradas.map((p) => ({ orden: p.orden, direccion: p.direccion, completada: !!p.completada_en })),
      mapa: envio.estado === 'Cancelado' ? null : await this.mapa.porEnvio(envio),
    };
  }
}
