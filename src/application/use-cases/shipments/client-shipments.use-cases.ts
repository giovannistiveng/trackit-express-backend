import { Actor, ROLES } from '../../../domain/entities/actor.entity';
import { ESTADOS_ENVIO, EstadoEnvio } from '../../../domain/entities/shipment.entity';
import { DriverRepositoryPort } from '../../../domain/repositories/driver.repository.port';
import { ShipmentRepositoryPort } from '../../../domain/repositories/shipment.repository.port';
import { VehicleRepositoryPort } from '../../../domain/repositories/vehicle.repository.port';
import { ZonaTarifaRepositoryPort } from '../../../domain/repositories/zona-tarifa.repository.port';
import { DistancePort } from '../../../domain/repositories/services.port';
import { ForbiddenError, ValidationError } from '../../../shared/errors';
import { AuditService } from '../../services/audit.service';
import { EnvioApi, presentarEnvio } from '../../services/envio.presenter';
import { envioExistente, exigirEstado, exigirMismoId, exigirRol } from '../../services/access';
import { textoValido } from '../../validation';
import { calcularTarifa, categoriaOpcional, validarRuta } from '../catalog/catalog.use-cases';

export interface CreateShipmentInput {
  origen: unknown;
  destino: unknown;
  tipo_carga: unknown;
  id_zona: unknown;
  categoria?: unknown;
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
    const { distancia_km } = await this.distancia.calcularDistancia(origen, destino);

    const envio = await this.envios.create({
      origen,
      destino,
      tipo_carga: tipoCarga,
      tarifa: calcularTarifa(zona.tarifa_base, distancia_km),
      pin_seguridad: generarPin(),
      id_cliente: actor.userId,
      id_zona: zona.id_zona as number,
      categoria,
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
    if (filtro === 'activos') estados = ['Pendiente', 'Asignado', 'En Ruta'];
    else if (filtro === 'historial') estados = ['Entregado'];
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

/** CU-010: calificación entera de 1 a 5, una sola vez, solo por el cliente dueño. */
export class RateShipmentUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, id: unknown, ratingCrudo: unknown) {
    exigirRol(actor, ROLES.CLIENTE);
    const rating = Number(ratingCrudo);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ValidationError('La calificación debe estar entre 1 y 5 estrellas');
    }
    const envio = await envioExistente(this.envios, id);
    if (envio.id_cliente !== actor.userId) throw new ForbiddenError('Solo puedes calificar tus propios envíos');
    exigirEstado(envio, ['Entregado'], 'Solo se pueden calificar envíos que ya fueron entregados');
    if ((await this.envios.findCalification(envio.id_envio as number)) !== null) {
      throw new ValidationError('Este envío ya fue calificado');
    }
    await this.envios.saveCalification(envio.id_envio as number, rating);
    await this.audit.registrar(actor, { accion: 'Calificación', entidad: 'Envío', idEntidad: envio.id_envio, detalle: `${rating} estrellas` });
    return { id_envio: envio.id_envio as number, calificacion: rating, estado: envio.estado };
  }
}
