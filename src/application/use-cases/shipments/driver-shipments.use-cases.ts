import { Actor, ROLES } from '../../../domain/entities/actor.entity';
import { ESTADOS_ACTIVOS_CONDUCTOR, Envio } from '../../../domain/entities/shipment.entity';
import { haversineKm, minutosEstimados } from '../../../domain/services/geo';
import { categoriasAtendibles, puedeAtender } from '../../../domain/services/tarifas';
import { PagoRepositoryPort, ParadaRepositoryPort } from '../../../domain/ports/platform.ports';
import { PagosService, PublicadorEnvios } from '../../services/pagos.service';
import { DriverRepositoryPort } from '../../../domain/ports/driver.repository.port';
import { LocationRepositoryPort } from '../../../domain/ports/location.repository.port';
import { ShipmentRepositoryPort } from '../../../domain/ports/shipment.repository.port';
import { ArchivoSubido, StoragePort } from '../../../domain/ports/storage.port';
import { VehicleRepositoryPort } from '../../../domain/ports/vehicle.repository.port';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors';
import { idValido } from '../../validation';
import { AuditService } from '../../services/audit.service';
import { NotificationService } from '../../services/notification.service';
import { EnvioApi, presentarEnvio } from '../../services/envio.presenter';
import {
  conductorAprobado,
  conductorDelActor,
  envioDelConductor,
  envioExistente,
  exigirEstado,
  exigirMismoId,
} from '../../services/access';

export const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];
/** Una ubicación más reciente que esto se considera "en vivo". */
export const VIGENCIA_UBICACION_MS = 2 * 60_000;
/** Posiciones que se devuelven para dibujar el recorrido. */
export const PUNTOS_RECORRIDO = 300;

/** CU-007: envíos Pendiente sin conductor, compatibles con los vehículos del conductor. */
export class ListAvailableShipmentsUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly vehicles: VehicleRepositoryPort,
    private readonly paradas?: ParadaRepositoryPort,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async execute(actor: Actor): Promise<EnvioApi[]> {
    const c = await conductorAprobado(this.drivers, actor);
    const vehiculos = (await this.vehicles.findByDriverId(c.id_conductor)).map((v) => v.categoria);
    const lista = await this.envios.findAvailable(categoriasAtendibles(vehiculos), this.reloj());
    return Promise.all(
      lista.map(async (e) => {
        const paradas = this.paradas ? await this.paradas.findByEnvio(e.id_envio as number) : undefined;
        return presentarEnvio({ ...e, paradas }, { incluirPin: false, vistaConductor: true });
      }),
    );
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
    return activo ? presentarEnvio(activo, { incluirPin: false, vistaConductor: true }) : null;
  }
}

/** CU-007: aceptar un servicio. */
export class AcceptShipmentUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly vehicles: VehicleRepositoryPort,
    private readonly audit: AuditService,
    private readonly notificaciones: NotificationService,
    private readonly publicador?: PublicadorEnvios,
    private readonly pagos?: PagoRepositoryPort,
  ) {}

  async execute(actor: Actor, input: { id_envio: unknown; id_conductor?: unknown }): Promise<EnvioApi> {
    const c = await conductorAprobado(this.drivers, actor);
    exigirMismoId(input.id_conductor, c.id_conductor, 'id_conductor');
    const envio = await envioExistente(this.envios, input.id_envio);
    if (envio.estado !== 'Pendiente') {
      throw new ValidationError(`El envío ya está en estado ${envio.estado} y no se puede asignar`);
    }
    if (envio.id_conductor) throw new ValidationError('Este envío ya fue tomado por otro conductor');
    if (this.publicador && this.pagos && !this.publicador.visible(envio, await this.pagos.findByEnvio(envio.id_envio as number))) {
      throw new ValidationError('Este envío todavía no está disponible para aceptar');
    }

    const activos = await this.envios.findByDriver(c.id_conductor, ESTADOS_ACTIVOS_CONDUCTOR);
    if (activos.length > 0) throw new ValidationError('Ya tienes un servicio activo. Termínalo antes de aceptar otro');

    if (envio.categoria) {
      const vehiculos = (await this.vehicles.findByDriverId(c.id_conductor)).map((v) => v.categoria);
      if (!puedeAtender(vehiculos, envio.categoria)) {
        throw new ValidationError(`Este envío requiere un vehículo ${envio.categoria}`);
      }
    }

    await this.envios.updateStatus(envio.id_envio as number, 'Asignado', c.id_conductor);
    const actualizado = await envioExistente(this.envios, envio.id_envio);
    await this.audit.registrar(actor, { accion: 'Servicio aceptado', entidad: 'Envío', idEntidad: envio.id_envio });
    await this.notificaciones.notificar({
      id_usuario: envio.id_cliente,
      tipo: 'envio_aceptado',
      titulo: 'Un conductor tomó tu envío',
      mensaje: `${c.nombre} recogerá tu envío #${envio.id_envio} en ${envio.origen}.`,
      id_envio: envio.id_envio,
    });
    return presentarEnvio(actualizado, { incluirPin: false, vistaConductor: true });
  }
}

/** Iniciar ruta: Asignado → En Ruta. */
export class StartRouteUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly audit: AuditService,
    private readonly notificaciones: NotificationService,
  ) {}

  async execute(actor: Actor, id: unknown): Promise<EnvioApi> {
    const { envio } = await envioDelConductor(this.envios, this.drivers, actor, id);
    exigirEstado(envio, ['Asignado'], `El envío está en estado ${envio.estado} y no se puede iniciar la ruta`);
    if (!envio.url_foto_recogida) throw new ValidationError('Toma la foto del paquete al recogerlo para iniciar la ruta');
    await this.envios.updateStatus(envio.id_envio as number, 'En Ruta');
    const actualizado = await envioExistente(this.envios, envio.id_envio);
    await this.audit.registrar(actor, { accion: 'Ruta iniciada', entidad: 'Envío', idEntidad: envio.id_envio });
    await this.notificaciones.notificar({
      id_usuario: envio.id_cliente,
      tipo: 'ruta_iniciada',
      titulo: 'Tu envío va en camino',
      mensaje: `El envío #${envio.id_envio} salió hacia ${envio.destino}. Puedes seguirlo en el mapa.`,
      id_envio: envio.id_envio,
    });
    return presentarEnvio(actualizado, { incluirPin: false, vistaConductor: true });
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
    if (!TIPOS_FOTO.includes(archivo.mimetype)) throw new ValidationError('La foto debe ser JPG, PNG o WebP');
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
    private readonly notificaciones: NotificationService,
    private readonly paradas?: ParadaRepositoryPort,
    private readonly pagos?: PagosService,
  ) {}

  async execute(actor: Actor, id: unknown, input: { url_foto: unknown; pin_seguridad: unknown; efectivo_recibido?: unknown }) {
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
    if (this.paradas) {
      const faltan = (await this.paradas.findByEnvio(envio.id_envio as number)).filter((p) => !p.completada_en);
      if (faltan.length > 0) throw new ValidationError(`Marca como hechas las paradas pendientes (${faltan.map((p) => p.orden).join(', ')}) antes de finalizar`);
    }
    if (envio.ida_y_vuelta && !envio.destino_visitado_en) {
      throw new ValidationError('Es un envío de ida y vuelta: marca la llegada al destino antes de finalizar en el origen');
    }
    const efectivo = (envio.metodo_pago ?? 'efectivo') === 'efectivo';
    if (efectivo && this.pagos && input.efectivo_recibido !== true) {
      throw new ValidationError(`Confirma que recibiste $ ${Math.round(envio.tarifa).toLocaleString('es-CO')} en efectivo`);
    }

    await this.envios.registerDelivery(envio.id_envio as number, input.url_foto);
    if (efectivo && this.pagos) await this.pagos.cobrarEfectivo(envio.id_envio as number);
    await this.audit.registrar(actor, { accion: 'Entrega validada', entidad: 'Envío', idEntidad: envio.id_envio });
    await this.notificaciones.notificar({
      id_usuario: envio.id_cliente,
      tipo: 'envio_entregado',
      titulo: '¡Tu envío fue entregado!',
      mensaje: `El envío #${envio.id_envio} llegó a ${envio.destino}. Cuéntanos cómo te fue.`,
      id_envio: envio.id_envio,
    });
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
    const envio = await envioConUbicacionVisible(this.envios, this.drivers, actor, id);
    const u = await this.ubicaciones.findLast(envio.id_envio as number);
    return u ? { lat: u.lat, lon: u.lon, capturado_en: u.capturado_en.toISOString() } : null;
  }
}

/** El cliente dueño, el conductor asignado y el administrador pueden ver dónde va el envío. */
async function envioConUbicacionVisible(
  envios: ShipmentRepositoryPort,
  drivers: DriverRepositoryPort,
  actor: Actor,
  id: unknown,
): Promise<Envio> {
  const envio = await envioExistente(envios, id);
  let permitido = actor.role === ROLES.ADMIN || (actor.role === ROLES.CLIENTE && envio.id_cliente === actor.userId);
  if (!permitido && actor.role === ROLES.CONDUCTOR) {
    const c = await drivers.findByUserId(actor.userId);
    permitido = !!c && c.id_conductor === envio.id_conductor;
  }
  if (!permitido) throw new ForbiddenError('No tienes acceso a este envío');
  return envio;
}

export interface Seguimiento {
  id_envio: number;
  estado: string;
  origen: { direccion: string; coords: { lat: number; lon: number } | null };
  destino: { direccion: string; coords: { lat: number; lon: number } | null };
  ultima_ubicacion: { lat: number; lon: number; capturado_en: string } | null;
  recorrido: { lat: number; lon: number; capturado_en: string }[];
  /** true si la última posición llegó hace menos de 2 minutos y el servicio está activo. */
  en_vivo: boolean;
  distancia_restante_km: number | null;
  eta_minutos: number | null;
}

/**
 * CU-008: seguimiento en el mapa. Devuelve origen y destino geocodificados, el recorrido del
 * conductor, si la señal está en vivo y, en ruta, la distancia y el tiempo estimado de llegada.
 */
export class GetTrackingUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly ubicaciones: LocationRepositoryPort,
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  async execute(actor: Actor, id: unknown): Promise<Seguimiento> {
    return this.porEnvio(await envioConUbicacionVisible(this.envios, this.drivers, actor, id));
  }

  /** Datos del mapa sin comprobar acceso (lo usa también el enlace público de seguimiento). */
  async porEnvio(envio: Envio): Promise<Seguimiento> {
    const activo = ESTADOS_ACTIVOS_CONDUCTOR.includes(envio.estado ?? 'Pendiente');
    const recorrido = activo || envio.estado === 'Entregado' ? await this.ubicaciones.findTrail(envio.id_envio as number, PUNTOS_RECORRIDO) : [];
    const ultima = recorrido.at(-1) ?? null;
    const enVivo = activo && !!ultima && this.ahora().getTime() - ultima.capturado_en.getTime() < VIGENCIA_UBICACION_MS;

    let distancia: number | null = null;
    let eta: number | null = null;
    // Ida y vuelta: después de pasar por el destino, la meta es volver al origen
    const meta =
      envio.estado === 'Asignado' || (envio.ida_y_vuelta && envio.destino_visitado_en) ? envio.origen_coords : envio.destino_coords;
    if (activo && ultima && meta) {
      distancia = Math.round(haversineKm(ultima, meta) * 10) / 10;
      eta = minutosEstimados(distancia);
      // En Asignado el conductor aún va a recoger: se suma el trayecto origen → destino
      if (envio.estado === 'Asignado' && envio.origen_coords && envio.destino_coords) {
        const tramo = haversineKm(envio.origen_coords, envio.destino_coords);
        distancia = Math.round((distancia + tramo) * 10) / 10;
        eta = minutosEstimados(distancia);
      }
    }

    const punto = (u: { lat: number; lon: number; capturado_en: Date }) => ({ lat: u.lat, lon: u.lon, capturado_en: u.capturado_en.toISOString() });
    return {
      id_envio: envio.id_envio as number,
      estado: envio.estado ?? 'Pendiente',
      origen: { direccion: envio.origen, coords: envio.origen_coords ?? null },
      destino: { direccion: envio.destino, coords: envio.destino_coords ?? null },
      ultima_ubicacion: ultima ? punto(ultima) : null,
      recorrido: recorrido.map(punto),
      en_vivo: enVivo,
      distancia_restante_km: distancia,
      eta_minutos: eta,
    };
  }
}

/**
 * El conductor recoge el paquete: sube la foto y el envío pasa a En Ruta en un solo paso.
 * El cliente recibe el aviso con la foto como constancia del estado del paquete.
 */
export class PickupShipmentUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly storage: StoragePort,
    private readonly audit: AuditService,
    private readonly notificaciones: NotificationService,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async execute(actor: Actor, id: unknown, archivo?: ArchivoSubido): Promise<EnvioApi> {
    if (!archivo) throw new ValidationError('Toma la foto del paquete al recogerlo');
    if (!TIPOS_FOTO.includes(archivo.mimetype)) throw new ValidationError('La foto debe ser JPG, PNG o WebP');
    const { envio } = await envioDelConductor(this.envios, this.drivers, actor, id);
    exigirEstado(envio, ['Asignado'], 'El paquete ya fue recogido o el servicio no está asignado');
    const url = await this.storage.upload(archivo, `trackit/recogidas/${envio.id_envio}`);
    await this.envios.registerPickup(envio.id_envio as number, url, this.reloj());
    await this.audit.registrar(actor, { accion: 'Paquete recogido', entidad: 'Envío', idEntidad: envio.id_envio });
    await this.notificaciones.notificar({
      id_usuario: envio.id_cliente,
      tipo: 'paquete_recogido',
      titulo: 'Tu paquete va en camino',
      mensaje: `El conductor recogió el envío #${envio.id_envio} y salió hacia ${envio.destino}. Mira la foto y síguelo en el mapa.`,
      id_envio: envio.id_envio,
    });
    return presentarEnvio(await envioExistente(this.envios, envio.id_envio), { incluirPin: false, vistaConductor: true });
  }
}

/** El conductor marca una parada intermedia como hecha. */
export class CompleteStopUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly paradas: ParadaRepositoryPort,
    private readonly notificaciones: NotificationService,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async execute(actor: Actor, id: unknown, idParadaCrudo: unknown) {
    const idParada = idValido(idParadaCrudo, 'id de la parada');
    const { envio } = await envioDelConductor(this.envios, this.drivers, actor, id);
    exigirEstado(envio, ['En Ruta'], 'Inicia la ruta antes de marcar paradas');
    const lista = await this.paradas.findByEnvio(envio.id_envio as number);
    const parada = lista.find((p) => p.id_parada === idParada);
    if (!parada) throw new NotFoundError('Esa parada no pertenece al envío');
    if (!parada.completada_en) {
      await this.paradas.completar(envio.id_envio as number, idParada, this.reloj());
      this.notificaciones.emitir(envio.id_cliente, 'envio', { id_envio: envio.id_envio, evento: 'parada', orden: parada.orden });
    }
    return { paradas: (await this.paradas.findByEnvio(envio.id_envio as number)).map((p) => ({ ...p, completada_en: p.completada_en?.toISOString() ?? null })) };
  }
}

/** Ida y vuelta: el conductor llegó al destino y ahora regresa al origen. */
export class ArriveDestinationUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly notificaciones: NotificationService,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async execute(actor: Actor, id: unknown): Promise<EnvioApi> {
    const { envio } = await envioDelConductor(this.envios, this.drivers, actor, id);
    if (!envio.ida_y_vuelta) throw new ValidationError('Este envío no es de ida y vuelta');
    exigirEstado(envio, ['En Ruta'], 'Inicia la ruta antes de marcar la llegada');
    await this.envios.markDestinationVisited(envio.id_envio as number, this.reloj());
    await this.notificaciones.notificar({
      id_usuario: envio.id_cliente,
      tipo: 'ruta_iniciada',
      titulo: 'Llegó al destino y regresa',
      mensaje: `El conductor llegó a ${envio.destino} con tu envío #${envio.id_envio} y ya viene de vuelta.`,
      id_envio: envio.id_envio,
    });
    return presentarEnvio(await envioExistente(this.envios, envio.id_envio), { incluirPin: false, vistaConductor: true });
  }
}

/** Trabajo programado: anuncia a los conductores los envíos programados que ya entran al tablero. */
export class AnnounceScheduledUseCase {
  constructor(
    private readonly envios: ShipmentRepositoryPort,
    private readonly pagos: PagoRepositoryPort,
    private readonly publicador: PublicadorEnvios,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<number> {
    const lista = await this.envios.findScheduledToAnnounce(this.reloj());
    for (const e of lista) await this.publicador.publicar(e, await this.pagos.findByEnvio(e.id_envio as number));
    return lista.length;
  }
}
