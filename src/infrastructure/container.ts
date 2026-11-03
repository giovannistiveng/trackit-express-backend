import path from 'path';
import { Pool } from 'pg';
import { config } from '../config';
import { Logger } from '../shared/logger';
import { AuditService } from '../application/services/audit.service';
import { LoginUserUseCase } from '../application/use-cases/auth/login-user.use-case';
import { RegisterUserUseCase } from '../application/use-cases/auth/register-user.use-case';
import { ListZonesUseCase,
  ListVehicleTariffsUseCase,
  SearchAddressUseCase,
  ReverseGeocodeUseCase, QuoteShipmentUseCase } from '../application/use-cases/catalog/catalog.use-cases';
import { NotificationService } from '../application/services/notification.service';
import {
  CancelShipmentUseCase,
  CreateShipmentUseCase,
  EditShipmentUseCase,
  ListClientShipmentsUseCase,
  PublicTrackingUseCase,
  RateShipmentUseCase,
  TrackShipmentUseCase,
} from '../application/use-cases/shipments/client-shipments.use-cases';
import { ListChatUseCase, SendChatMessageUseCase } from '../application/use-cases/shipments/chat.use-cases';
import {
  DriverWalletUseCase,
  GenerateSettlementsUseCase,
  GetShipmentPaymentUseCase,
  ListPaymentsAdminUseCase,
  ListSettlementsUseCase,
  PaySettlementUseCase,
  ProcessPendingPaymentsUseCase,
  RetryNequiPaymentUseCase,
  RetryRefundUseCase,
  SwitchToCashUseCase,
} from '../application/use-cases/payments/payment.use-cases';
import {
  RequestPasswordResetUseCase,
  ResetPasswordUseCase,
  SendVerificationEmailUseCase,
  VerifyEmailUseCase,
} from '../application/use-cases/auth/account-recovery.use-cases';
import { SubscribePushUseCase, UnsubscribePushUseCase } from '../application/use-cases/realtime/push.use-cases';
import { PagosService, PublicadorEnvios } from '../application/services/pagos.service';
import { PushService } from '../application/services/push.service';
import { MailerPort, PaymentGatewayPort, PushSenderPort } from '../domain/repositories/platform.ports';
import {
  ChatRepositoryPostgres,
  LiquidacionRepositoryPostgres,
  PagoRepositoryPostgres,
  ParadaRepositoryPostgres,
  PushRepositoryPostgres,
  TokenRepositoryPostgres,
} from './database/repositories/platform.repositories.postgres';
import { BuzonLocalMailer, SmtpMailer } from './external/mailers';
import { NequiConectaGateway, NequiSimuladoGateway } from './external/nequi.gateways';
import { EventBusMemoria } from './realtime/event-bus';
import { TicketsEventos } from './realtime/tickets';
import { FcmSender, WebPushSender, clavesVapid } from './realtime/push.senders';
import {
  AcceptShipmentUseCase,
  AnnounceScheduledUseCase,
  ArriveDestinationUseCase,
  CompleteStopUseCase,
  PickupShipmentUseCase,
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
  UpdateZoneUseCase,
  ListZonesAdminUseCase,
  CreateZoneUseCase,
  UpdateVehicleTariffUseCase,
  DeleteContactUseCase,
  DeleteZoneUseCase,
} from '../application/use-cases/admin/admin.use-cases';
import { ChangePasswordUseCase, GetMyProfileUseCase, UpdateMyProfileUseCase } from '../application/use-cases/users/user.use-cases';
import {
  CountUnreadNotificationsUseCase,
  ListNotificationsUseCase,
  MarkAllNotificationsReadUseCase,
  MarkNotificationReadUseCase,
  DeleteNotificationUseCase,
  DeleteReadNotificationsUseCase,
} from '../application/use-cases/notifications/notification.use-cases';
import { GetPublicStatsUseCase, ListPublicZonesUseCase, SubmitContactUseCase } from '../application/use-cases/public/public.use-cases';
import { ContactRepositoryPostgres } from './database/repositories/contact.repository.postgres';
import { NotificationRepositoryPostgres } from './database/repositories/notification.repository.postgres';
import { DistancePort, GeocodingPort, PasswordHasherPort, TokenServicePort } from '../domain/repositories/services.port';
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
import { TarifaVehiculoRepositoryPostgres } from './database/repositories/tarifa-vehiculo.repository.postgres';
import { Cotizador } from '../application/services/cotizador';
import { HashService } from './security/hash.service';
import { JWTService } from './security/jwt.service';

export interface Dependencias {
  pool: Pool;
  log: Logger;
  /** Reemplazables en pruebas. */
  mailer?: MailerPort;
  pasarela?: PaymentGatewayPort;
  pushSenders?: PushSenderPort[];
  /** Reemplazables en pruebas. */
  tokens?: TokenServicePort;
  hasher?: PasswordHasherPort;
  distancia?: DistancePort;
  geocodificador?: GeocodingPort;
  /** Hora actual (las pruebas la fijan para que el recargo nocturno no dependa del reloj). */
  reloj?: () => Date;
  storage?: StoragePort;
}

/** Composición de la aplicación: repositorios, adaptadores y casos de uso. */
export function crearContenedor(d: Dependencias) {
  const tokens = d.tokens ?? new JWTService();
  const hasher = d.hasher ?? new HashService();
  const osm = new OpenStreetAdapter();
  const distancia = d.distancia ?? osm;
  const geocodificador = d.geocodificador ?? osm;
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
  const reloj = d.reloj ?? (() => new Date());
  const bus = new EventBusMemoria();
  const tickets = new TicketsEventos();
  const pushRepo = new PushRepositoryPostgres(d.pool);
  // En pruebas (pushSenders inyectados) no se generan ni guardan claves
  const claves = d.pushSenders ? { publica: '', privada: '' } : clavesVapid(config.push.vapidPublica, config.push.vapidPrivada);
  const senders: PushSenderPort[] =
    d.pushSenders ??
    [new WebPushSender(claves, config.push.vapidContacto), FcmSender.desdeArchivo(config.push.fcmCuentaServicio)].filter(
      (x): x is WebPushSender | FcmSender => x !== null,
    );
  const push = new PushService(pushRepo, senders, (e) => d.log.child('Push').warn('No se pudo enviar la notificación push', e));
  const notificacionesRepo = new NotificationRepositoryPostgres(d.pool);
  const notificaciones = new NotificationService(notificacionesRepo, (e) => d.log.child('Notificaciones').warn('No se pudo crear la notificación', e), {
    bus,
    push,
  });
  const mailer =
    d.mailer ?? (config.correo.host ? new SmtpMailer(config.correo) : new BuzonLocalMailer(path.join(config.log.dir, 'correos')));
  const pasarela =
    d.pasarela ??
    (config.nequi.modo === 'conecta' ? new NequiConectaGateway(config.nequi) : new NequiSimuladoGateway(config.nequi.aprobacionSimuladaSeg * 1000));
  const tokensCuenta = new TokenRepositoryPostgres(d.pool);
  const pagosRepo = new PagoRepositoryPostgres(d.pool);
  const liquidaciones = new LiquidacionRepositoryPostgres(d.pool);
  const paradas = new ParadaRepositoryPostgres(d.pool);
  const chat = new ChatRepositoryPostgres(d.pool);
  const metricas = new MetricsRepositoryPostgres(d.pool);
  const contactos = new ContactRepositoryPostgres(d.pool);
  const tarifas = new TarifaVehiculoRepositoryPostgres(d.pool);
  const cotizador = new Cotizador(zonas, tarifas, distancia, d.reloj);
  const publicador = new PublicadorEnvios(envios, drivers, notificaciones, reloj);
  const pagos = new PagosService(pagosRepo, pasarela, envios, publicador, notificaciones, reloj);
  const verificacion = new SendVerificationEmailUseCase(users, tokensCuenta, mailer, config.frontendUrl, reloj);
  const seguimiento = new GetTrackingUseCase(envios, drivers, ubicaciones, reloj);

  return {
    tokens,
    bus,
    tickets,
    clavePush: claves.publica,
    pasarela: pasarela.nombre,
    storageLocal: storage instanceof LocalDiskStorage,
    auth: {
      registrar: new RegisterUserUseCase(users, hasher, audit, verificacion),
      login: new LoginUserUseCase(users, hasher, tokens, audit),
      enviarVerificacion: verificacion,
      verificarCorreo: new VerifyEmailUseCase(users, tokensCuenta, audit, reloj),
      olvidePassword: new RequestPasswordResetUseCase(users, tokensCuenta, mailer, config.frontendUrl, audit, reloj),
      restablecerPassword: new ResetPasswordUseCase(users, tokensCuenta, hasher, mailer, audit, reloj),
    },
    catalogo: {
      zonas: new ListZonesUseCase(zonas),
      cotizar: new QuoteShipmentUseCase(cotizador),
      tarifas: new ListVehicleTariffsUseCase(tarifas),
      buscarDireccion: new SearchAddressUseCase(geocodificador),
      direccionDe: new ReverseGeocodeUseCase(geocodificador),
    },
    envios: {
      crear: new CreateShipmentUseCase(envios, cotizador, audit, paradas, pagos, publicador),
      editar: new EditShipmentUseCase(envios, audit),
      delCliente: new ListClientShipmentsUseCase(envios),
      rastrear: new TrackShipmentUseCase(envios, drivers, vehiculos, paradas, pagosRepo, chat),
      calificar: new RateShipmentUseCase(envios, drivers, audit, notificaciones),
      cancelar: new CancelShipmentUseCase(envios, drivers, audit, notificaciones, pagos),
      disponibles: new ListAvailableShipmentsUseCase(envios, drivers, vehiculos, paradas, reloj),
      activo: new GetActiveServiceUseCase(envios, drivers),
      aceptar: new AcceptShipmentUseCase(envios, drivers, vehiculos, audit, notificaciones, publicador, pagosRepo),
      recoger: new PickupShipmentUseCase(envios, drivers, storage, audit, notificaciones, reloj),
      iniciarRuta: new StartRouteUseCase(envios, drivers, audit, notificaciones),
      completarParada: new CompleteStopUseCase(envios, drivers, paradas, notificaciones, reloj),
      llegadaDestino: new ArriveDestinationUseCase(envios, drivers, notificaciones, reloj),
      evidencia: new UploadEvidenceUseCase(envios, drivers, storage),
      validarEntrega: new ValidateDeliveryUseCase(envios, drivers, audit, notificaciones, paradas, pagos),
      registrarUbicacion: new RecordLocationUseCase(envios, drivers, ubicaciones),
      ultimaUbicacion: new GetLastLocationUseCase(envios, drivers, ubicaciones),
      seguimiento,
      seguimientoPublico: new PublicTrackingUseCase(envios, drivers, vehiculos, paradas, seguimiento),
      chat: new ListChatUseCase(envios, drivers, chat),
      enviarMensaje: new SendChatMessageUseCase(envios, drivers, users, chat, notificaciones),
      anunciarProgramados: new AnnounceScheduledUseCase(envios, pagosRepo, publicador, reloj),
    },
    pagos: {
      estado: new GetShipmentPaymentUseCase(envios, drivers, pagosRepo, pagos),
      reintentar: new RetryNequiPaymentUseCase(envios, pagosRepo, pagos, audit),
      efectivo: new SwitchToCashUseCase(envios, pagosRepo, publicador, audit),
      procesarPendientes: new ProcessPendingPaymentsUseCase(pagosRepo, pagos),
      billetera: new DriverWalletUseCase(drivers, liquidaciones),
      generarLiquidaciones: new GenerateSettlementsUseCase(liquidaciones, drivers, notificaciones, audit, reloj),
      liquidaciones: new ListSettlementsUseCase(liquidaciones),
      pagarLiquidacion: new PaySettlementUseCase(liquidaciones, drivers, notificaciones, audit, reloj),
      listar: new ListPaymentsAdminUseCase(pagosRepo),
      reembolso: new RetryRefundUseCase(pagosRepo, pagos, audit),
    },
    push: {
      suscribir: new SubscribePushUseCase(pushRepo),
      desuscribir: new UnsubscribePushUseCase(pushRepo),
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
      borrar: new DeleteNotificationUseCase(notificacionesRepo),
      borrarLeidas: new DeleteReadNotificationsUseCase(notificacionesRepo),
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
      tarifa: new UpdateZoneUseCase(zonas, audit),
      zonas: new ListZonesAdminUseCase(zonas),
      crearZona: new CreateZoneUseCase(zonas, audit),
      tarifaVehiculo: new UpdateVehicleTariffUseCase(tarifas, audit),
      contactos: new ListContactsUseCase(contactos),
      atenderContacto: new ResolveContactUseCase(contactos, audit),
      borrarContacto: new DeleteContactUseCase(contactos, audit),
      borrarZona: new DeleteZoneUseCase(zonas, audit),
    },
  };
}

export type Contenedor = ReturnType<typeof crearContenedor>;
