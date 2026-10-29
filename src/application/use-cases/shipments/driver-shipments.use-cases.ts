import { Actor, ROLES } from '../../../domain/entities/actor.entity';
import { ESTADOS_ACTIVOS_CONDUCTOR } from '../../../domain/entities/shipment.entity';
import { DriverRepositoryPort } from '../../../domain/repositories/driver.repository.port';
import { LocationRepositoryPort } from '../../../domain/repositories/location.repository.port';
import { ShipmentRepositoryPort } from '../../../domain/repositories/shipment.repository.port';
import { ArchivoSubido, StoragePort } from '../../../domain/repositories/storage.port';
import { VehicleRepositoryPort } from '../../../domain/repositories/vehicle.repository.port';
import { ForbiddenError, ValidationError } from '../../../shared/errors';
import { AuditService } from '../../services/audit.service';
import { EnvioApi, presentarEnvio } from '../../services/envio.presenter';
import {
  conductorAprobado,
  conductorDelActor,
  envioDelConductor,
  envioExistente,
  exigirEstado,
  exigirMismoId,
} from '../../services/access';

export const TIPOS_FOTO = ['image/jpeg', 'image/png'];

/** CU-007: envíos Pendiente sin conductor, compatibles con los vehículos del conductor. */
export class ListAvailableShipmentsUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly vehicles: VehicleRepositoryPort,
  ) {}

  async execute(actor: Actor): Promise<EnvioApi[]> {
    const c = await conductorAprobado(this.drivers, actor);
    const categorias = (await this.vehicles.findByDriverId(c.id_conductor)).map((v) => v.categoria);
    const lista = await this.envios.findAvailable(categorias);
    return lista.map((e) => presentarEnvio(e, { incluirPin: false }));
  }
}

/** Servicio en curso del conductor (RN_OP_002: como máximo uno). */
export class GetActiveServiceUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
  ) {}

  async execute(actor: Actor): Promise<EnvioApi | null> {
    const c = await conductorDelActor(this.drivers, actor);
    const [activo] = await this.envios.findByDriver(c.id_conductor, ESTADOS_ACTIVOS_CONDUCTOR);
    return activo ? presentarEnvio(activo, { incluirPin: false }) : null;
  }
}

/** CU-007: aceptar un servicio. */
export class AcceptShipmentUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly vehicles: VehicleRepositoryPort,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, input: { id_envio: unknown; id_conductor?: unknown }): Promise<EnvioApi> {
    const c = await conductorAprobado(this.drivers, actor);
    exigirMismoId(input.id_conductor, c.id_conductor, 'id_conductor');
    const envio = await envioExistente(this.envios, input.id_envio);
    if (envio.estado !== 'Pendiente') {
      throw new ValidationError(`El envío ya está en estado ${envio.estado} y no se puede asignar`);
    }
    if (envio.id_conductor) throw new ValidationError('Este envío ya fue tomado por otro conductor');

    const activos = await this.envios.findByDriver(c.id_conductor, ESTADOS_ACTIVOS_CONDUCTOR);
    if (activos.length > 0) throw new ValidationError('Ya tienes un servicio activo. Termínalo antes de aceptar otro');

    if (envio.categoria) {
      const categorias = (await this.vehicles.findByDriverId(c.id_conductor)).map((v) => v.categoria);
      if (!categorias.includes(envio.categoria)) {
        throw new ValidationError(`Este envío requiere un vehículo ${envio.categoria}`);
      }
    }

    await this.envios.updateStatus(envio.id_envio as number, 'Asignado', c.id_conductor);
    const actualizado = await envioExistente(this.envios, envio.id_envio);
    await this.audit.registrar(actor, { accion: 'Servicio aceptado', entidad: 'Envío', idEntidad: envio.id_envio });
    return presentarEnvio(actualizado, { incluirPin: false });
  }
}

/** Iniciar ruta: Asignado → En Ruta. */
export class StartRouteUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, id: unknown): Promise<EnvioApi> {
    const { envio } = await envioDelConductor(this.envios, this.drivers, actor, id);
    exigirEstado(envio, ['Asignado'], `El envío está en estado ${envio.estado} y no se puede iniciar la ruta`);
    await this.envios.updateStatus(envio.id_envio as number, 'En Ruta');
    const actualizado = await envioExistente(this.envios, envio.id_envio);
    await this.audit.registrar(actor, { accion: 'Ruta iniciada', entidad: 'Envío', idEntidad: envio.id_envio });
    return presentarEnvio(actualizado, { incluirPin: false });
  }
}

/** Sube la foto de evidencia de la entrega y devuelve su URL. */
export class UploadEvidenceUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly storage: StoragePort,
  ) {}

  async execute(actor: Actor, id: unknown, archivo?: ArchivoSubido): Promise<{ url_foto: string }> {
    if (!archivo) throw new ValidationError('No se proporcionó ningún archivo');
    if (!TIPOS_FOTO.includes(archivo.mimetype)) throw new ValidationError('La foto debe ser JPG o PNG');
    const { envio } = await envioDelConductor(this.envios, this.drivers, actor, id);
    exigirEstado(envio, ['En Ruta'], 'Inicia la ruta antes de registrar la evidencia');
    const url = await this.storage.upload(archivo, `trackit/evidencias/${envio.id_envio}`);
    return { url_foto: url };
  }
}

/** CU-009: validación de entrega con PIN y evidencia. */
export class ValidateDeliveryUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, id: unknown, input: { url_foto: unknown; pin_seguridad: unknown }) {
    if (typeof input.url_foto !== 'string' || !/^https?:\/\/\S+$/.test(input.url_foto)) {
      throw new ValidationError('La evidencia fotográfica (url_foto) es obligatoria');
    }
    const { envio } = await envioDelConductor(this.envios, this.drivers, actor, id);
    if (envio.estado === 'Entregado') throw new ValidationError('Este envío ya ha sido validado como entregado');
    exigirEstado(envio, ['En Ruta'], 'Inicia la ruta antes de validar la entrega');
    if (input.pin_seguridad === undefined || input.pin_seguridad === null || input.pin_seguridad === '') {
      throw new ValidationError('El PIN de seguridad es obligatorio para validar la entrega');
    }
    if (String(input.pin_seguridad) !== String(envio.pin_seguridad)) throw new ValidationError('PIN incorrecto');

    await this.envios.registerDelivery(envio.id_envio as number, input.url_foto);
    await this.audit.registrar(actor, { accion: 'Entrega validada', entidad: 'Envío', idEntidad: envio.id_envio });
    return { id_envio: envio.id_envio as number, estado: 'Entregado', origen: envio.origen, destino: envio.destino, url_foto: input.url_foto };
  }
}

/** CU-008: el conductor reporta su posición durante el servicio. */
export class RecordLocationUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly ubicaciones: LocationRepositoryPort,
  ) {}

  async execute(actor: Actor, id: unknown, input: { lat: unknown; lon: unknown; capturado_en?: unknown }): Promise<void> {
    const lat = Number(input.lat);
    const lon = Number(input.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new ValidationError('Coordenadas fuera de rango');
    }
    const capturado = input.capturado_en ? new Date(String(input.capturado_en)) : new Date();
    if (Number.isNaN(capturado.getTime())) throw new ValidationError('La fecha de captura no es válida');
    const { envio } = await envioDelConductor(this.envios, this.drivers, actor, id);
    exigirEstado(envio, ESTADOS_ACTIVOS_CONDUCTOR, 'Solo se comparte la ubicación durante un servicio activo');
    await this.ubicaciones.save({ id_envio: envio.id_envio as number, lat, lon, capturado_en: capturado });
  }
}

/** Última posición conocida del conductor de un envío. */
export class GetLastLocationUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly ubicaciones: LocationRepositoryPort,
  ) {}

  async execute(actor: Actor, id: unknown) {
    const envio = await envioExistente(this.envios, id);
    let permitido = actor.role === ROLES.ADMIN || (actor.role === ROLES.CLIENTE && envio.id_cliente === actor.userId);
    if (!permitido && actor.role === ROLES.CONDUCTOR) {
      const c = await this.drivers.findByUserId(actor.userId);
      permitido = !!c && c.id_conductor === envio.id_conductor;
    }
    if (!permitido) throw new ForbiddenError('No tienes acceso a este envío');
    const u = await this.ubicaciones.findLast(envio.id_envio as number);
    return u ? { lat: u.lat, lon: u.lon, capturado_en: u.capturado_en.toISOString() } : null;
  }
}
