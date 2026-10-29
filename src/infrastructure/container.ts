import { Pool } from 'pg';
import { config } from '../config';
import { Logger } from '../shared/logger';
import { AuditService } from '../application/services/audit.service';
import { LoginUserUseCase } from '../application/use-cases/auth/login-user.use-case';
import { RegisterUserUseCase } from '../application/use-cases/auth/register-user.use-case';
import { ListZonesUseCase, QuoteShipmentUseCase } from '../application/use-cases/catalog/catalog.use-cases';
import { NotificationService } from '../application/services/notification.service';
import {
  CancelShipmentUseCase,
  CreateShipmentUseCase,
  ListClientShipmentsUseCase,
  RateShipmentUseCase,
  TrackShipmentUseCase,
} from '../application/use-cases/shipments/client-shipments.use-cases';
import {
  AcceptShipmentUseCase,
  GetActiveServiceUseCase,
  GetLastLocationUseCase,
  GetTrackingUseCase,
  ListAvailableShipmentsUseCase,
  RecordLocationUseCase,
  StartRouteUseCase,
  UploadEvidenceUseCase,
  ValidateDeliveryUseCase,
} from '../application/use-cases/shipments/driver-shipments.use-cases';
import {
  DecideDriverApprovalUseCase,
  GetDriverProfileUseCase,
  GetDriverSummaryUseCase,
  ListDriverApplicantsUseCase,
  ListDriverHistoryUseCase,
  RegisterVehicleUseCase,
  UploadDriverDocumentUseCase,
} from '../application/use-cases/drivers/driver.use-cases';
import {
  GetDashboardMetricsUseCase,
  ListContactsUseCase,
  ResolveContactUseCase,
  SearchAuditUseCase,
  SearchShipmentsAdminUseCase,
  UpdateZoneTariffUseCase,
} from '../application/use-cases/admin/admin.use-cases';
import { ChangePasswordUseCase, GetMyProfileUseCase, UpdateMyProfileUseCase } from '../application/use-cases/users/user.use-cases';
import {
  CountUnreadNotificationsUseCase,
  ListNotificationsUseCase,
  MarkAllNotificationsReadUseCase,
  MarkNotificationReadUseCase,
} from '../application/use-cases/notifications/notification.use-cases';
import { GetPublicStatsUseCase, ListPublicZonesUseCase, SubmitContactUseCase } from '../application/use-cases/public/public.use-cases';
import { ContactRepositoryPostgres } from './database/repositories/contact.repository.postgres';
import { NotificationRepositoryPostgres } from './database/repositories/notification.repository.postgres';
import { DistancePort, PasswordHasherPort, TokenServicePort } from '../domain/repositories/services.port';
import { StoragePort } from '../domain/repositories/storage.port';
import { AuditRepositoryPostgres } from './database/repositories/audit.repository.postgres';
import { DocumentoConductorRepositoryPostgres } from './database/repositories/documento-conductor.repository.postgres';
import { DriverRepositoryPostgres } from './database/repositories/driver.repository.postgres';
import { LocationRepositoryPostgres } from './database/repositories/location.repository.postgres';
import { MetricsRepositoryPostgres } from './database/repositories/metrics.repository.postgres';
import { ShipmentRepositoryPostgres } from './database/repositories/shipment.repository.postgres';
import { UserRepositoryPostgres } from './database/repositories/user.repository.postgres';
import { VehicleRepositoryPostgres } from './database/repositories/vehicle.repository.postgres';
import { ZonaTarifaRepositoryPostgres } from './database/repositories/zona-tarifa.repository.postgres';
import { CloudinaryStorage, cloudinaryConfigurado } from './external/cloudinary.adapter';
import { LocalDiskStorage } from './external/local-disk.storage';
import { OpenStreetAdapter } from './external/open-street.adapter';
import { HashService } from './security/hash.service';
import { JWTService } from './security/jwt.service';

export interface Dependencias {
  pool: Pool;
  log: Logger;
  /** Reemplazables en pruebas. */
  tokens?: TokenServicePort;
  hasher?: PasswordHasherPort;
  distancia?: DistancePort;
  storage?: StoragePort;
}

/** Composición de la aplicación: repositorios, adaptadores y casos de uso. */
export function crearContenedor(d: Dependencias) {
  const tokens = d.tokens ?? new JWTService();
  const hasher = d.hasher ?? new HashService();
  const distancia = d.distancia ?? new OpenStreetAdapter();
  const storage =
    d.storage ??
    (cloudinaryConfigurado(config.cloudinary) ? new CloudinaryStorage(config.cloudinary) : new LocalDiskStorage(config.uploadsDir, config.publicUrl));

  const users = new UserRepositoryPostgres(d.pool);
  const drivers = new DriverRepositoryPostgres(d.pool);
  const envios = new ShipmentRepositoryPostgres(d.pool);
  const zonas = new ZonaTarifaRepositoryPostgres(d.pool);
  const vehiculos = new VehicleRepositoryPostgres(d.pool);
  const documentos = new DocumentoConductorRepositoryPostgres(d.pool);
  const ubicaciones = new LocationRepositoryPostgres(d.pool);
  const audit = new AuditService(new AuditRepositoryPostgres(d.pool), (e) => d.log.child('Auditoria').warn('No se pudo registrar la auditoría', e));
  const notificacionesRepo = new NotificationRepositoryPostgres(d.pool);
  const notificaciones = new NotificationService(notificacionesRepo, (e) => d.log.child('Notificaciones').warn('No se pudo crear la notificación', e));
  const metricas = new MetricsRepositoryPostgres(d.pool);
  const contactos = new ContactRepositoryPostgres(d.pool);

  return {
    tokens,
    storageLocal: storage instanceof LocalDiskStorage,
    auth: {
      registrar: new RegisterUserUseCase(users, hasher, audit),
      login: new LoginUserUseCase(users, hasher, tokens, audit),
    },
    catalogo: {
      zonas: new ListZonesUseCase(zonas),
      cotizar: new QuoteShipmentUseCase(zonas, distancia),
    },
    envios: {
      crear: new CreateShipmentUseCase(envios, zonas, distancia, audit),
      delCliente: new ListClientShipmentsUseCase(envios),
      rastrear: new TrackShipmentUseCase(envios, drivers, vehiculos),
      calificar: new RateShipmentUseCase(envios, drivers, audit, notificaciones),
      cancelar: new CancelShipmentUseCase(envios, drivers, audit, notificaciones),
      disponibles: new ListAvailableShipmentsUseCase(envios, drivers, vehiculos),
      activo: new GetActiveServiceUseCase(envios, drivers),
      aceptar: new AcceptShipmentUseCase(envios, drivers, vehiculos, audit, notificaciones),
      iniciarRuta: new StartRouteUseCase(envios, drivers, audit, notificaciones),
      evidencia: new UploadEvidenceUseCase(envios, drivers, storage),
      validarEntrega: new ValidateDeliveryUseCase(envios, drivers, audit, notificaciones),
      registrarUbicacion: new RecordLocationUseCase(envios, drivers, ubicaciones),
      ultimaUbicacion: new GetLastLocationUseCase(envios, drivers, ubicaciones),
      seguimiento: new GetTrackingUseCase(envios, drivers, ubicaciones),
    },
    conductores: {
      perfil: new GetDriverProfileUseCase(drivers, vehiculos),
      registrarVehiculo: new RegisterVehicleUseCase(vehiculos, drivers, audit),
      subirDocumento: new UploadDriverDocumentUseCase(documentos, drivers, storage, audit),
      postulantes: new ListDriverApplicantsUseCase(drivers),
      decidir: new DecideDriverApprovalUseCase(drivers, audit, notificaciones),
      resumen: new GetDriverSummaryUseCase(drivers, envios),
      historial: new ListDriverHistoryUseCase(drivers, envios),
    },
    usuarios: {
      perfil: new GetMyProfileUseCase(users),
      actualizar: new UpdateMyProfileUseCase(users, audit),
      cambiarPassword: new ChangePasswordUseCase(users, hasher, audit),
    },
    notificaciones: {
      listar: new ListNotificationsUseCase(notificacionesRepo),
      noLeidas: new CountUnreadNotificationsUseCase(notificacionesRepo),
      leer: new MarkNotificationReadUseCase(notificacionesRepo),
      leerTodas: new MarkAllNotificationsReadUseCase(notificacionesRepo),
    },
    publico: {
      estadisticas: new GetPublicStatsUseCase(metricas),
      zonas: new ListPublicZonesUseCase(zonas),
      contacto: new SubmitContactUseCase(contactos, audit),
    },
    admin: {
      metricas: new GetDashboardMetricsUseCase(metricas),
      auditoria: new SearchAuditUseCase(new AuditRepositoryPostgres(d.pool)),
      envios: new SearchShipmentsAdminUseCase(envios),
      tarifa: new UpdateZoneTariffUseCase(zonas, audit),
      contactos: new ListContactsUseCase(contactos),
      atenderContacto: new ResolveContactUseCase(contactos, audit),
    },
  };
}

export type Contenedor = ReturnType<typeof crearContenedor>;
