import { Actor, ROLES } from '../../../domain/entities/actor.entity';
import { ESTADOS_ACTIVOS_CLIENTE, ESTADOS_ENVIO, EstadoEnvio } from '../../../domain/entities/shipment.entity';
import { coordenadasValidas } from '../../../domain/services/geo';
import { DriverRepositoryPort } from '../../../domain/repositories/driver.repository.port';
import { ShipmentRepositoryPort } from '../../../domain/repositories/shipment.repository.port';
import { VehicleRepositoryPort } from '../../../domain/repositories/vehicle.repository.port';
import { ZonaTarifaRepositoryPort } from '../../../domain/repositories/zona-tarifa.repository.port';
import { DistancePort } from '../../../domain/repositories/services.port';
import { ForbiddenError, ValidationError } from '../../../shared/errors';
import { AuditService } from '../../services/audit.service';
import { NotificationService } from '../../services/notification.service';
import { EnvioApi, presentarEnvio } from '../../services/envio.presenter';
import { envioExistente, exigirEstado, exigirMismoId, exigirRol } from '../../services/access';
import { textoOpcional, textoValido } from '../../validation';
import { calcularTarifa, categoriaOpcional, validarRuta } from '../catalog/catalog.use-cases';

export interface CreateShipmentInput {
  origen: unknown;
  destino: unknown;
  tipo_carga: unknown;
  id_zona: unknown;
  categoria?: unknown;
  notas?: unknown;
  id_cliente?: unknown;
}

/** PIN de 4 dígitos (1000–9999). */
export function generarPin(aleatorio: () => number = Math.random): string {
  return Math.floor(1000 + aleatorio() * 9000).toString();
}

/** CU-006: solicitud de envío. El cliente sale del token, no del cuerpo. */
export class CreateShipmentUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly zonas: ZonaTarifaRepositoryPort,
    private readonly distancia: DistancePort,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, input: CreateShipmentInput): Promise<EnvioApi> {
    exigirRol(actor, ROLES.CLIENTE);
    exigirMismoId(input.id_cliente, actor.userId, 'id_cliente');
    const { origen, destino, zona } = await validarRuta(this.zonas, input);
    const tipoCarga = textoValido(input.tipo_carga, 'tipo_carga', 1, 80);
    const categoria = categoriaOpcional(input.categoria);
    const notas = textoOpcional(input.notas, 'notas', 300);
    const ruta = await this.distancia.calcularDistancia(origen, destino);
    const distancia_km = ruta.distancia_km;

    const envio = await this.envios.create({
      origen,
      destino,
      tipo_carga: tipoCarga,
      tarifa: calcularTarifa(zona.tarifa_base, distancia_km),
      pin_seguridad: generarPin(),
      id_cliente: actor.userId,
      id_zona: zona.id_zona as number,
      categoria,
      notas,
      distancia_km: Math.round(distancia_km * 100) / 100,
      origen_coords: coordenadasValidas(ruta.origen) ? ruta.origen : null,
      destino_coords: coordenadasValidas(ruta.destino) ? ruta.destino : null,
    });
    await this.audit.registrar(actor, { accion: 'Envío creado', entidad: 'Envío', idEntidad: envio.id_envio, detalle: `${origen} → ${destino}` });
    return presentarEnvio(envio, { incluirPin: true });
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

    const [historial, calificacion, conductor] = await Promise.all([
      this.envios.getStatusHistory(envio.id_envio as number),
      this.envios.findCalification(envio.id_envio as number),
      this.resumenConductor(envio.id_conductor),
    ]);
    return presentarEnvio(envio, { incluirPin: esDueno, historial, calificacion, conductor });
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
    await this.audit.registrar(actor, {
      accion: 'Envío cancelado',
      entidad: 'Envío',
      idEntidad: envio.id_envio,
      detalle: motivo ?? (esAdmin ? 'Por administración' : 'Por el cliente'),
    });

    const aviso = `El envío #${envio.id_envio} (${envio.origen} → ${envio.destino}) fue cancelado${motivo ? `: ${motivo}` : '.'}`;
    if (esAdmin) {
      await this.notificaciones.notificar({ id_usuario: envio.id_cliente, tipo: 'envio_cancelado', titulo: 'Tu envío fue cancelado', mensaje: aviso, id_envio: envio.id_envio });
    }
    const conductor = envio.id_conductor ? await this.drivers.findById(envio.id_conductor) : null;
    if (conductor) {
      await this.notificaciones.notificar({ id_usuario: conductor.id_usuario, tipo: 'envio_cancelado', titulo: 'Servicio cancelado', mensaje: aviso, id_envio: envio.id_envio });
    }
    const actualizado = await envioExistente(this.envios, envio.id_envio);
    return presentarEnvio(actualizado, { incluirPin: false });
  }
}
