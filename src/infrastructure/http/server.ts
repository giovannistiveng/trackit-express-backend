import express from 'express';
import cors from 'cors';
import { config } from '../../config';
import { pool, testConnection } from '../../config/database';
import { AppError } from '../../shared/errors';
import { HashService } from '../security/hash.service';
import { JWTService } from '../security/jwt.service';
import { UserRepositoryPostgres } from '../database/repositories/user.repository.postgres';
import { RegisterUserUseCase } from '../../application/use-cases/auth/register-user.use-case';
import { LoginUserUseCase } from '../../application/use-cases/auth/login-user.use-case';
import { AuthController } from './controllers/auth.controller';
import { createAuthRoutes } from './routes/auth.routes';
import { VehicleRepositoryPostgres } from '../database/repositories/vehicle.repository.postgres';
import { RegisterVehicleUseCase } from '../../application/use-cases/vehicles/register-vehicle.use-case';
import { VehicleController } from './controllers/vehicle.controller';
import { createVehicleRoutes } from './routes/vehicle.routes';
import { DocumentoConductorRepositoryPostgres } from '../database/repositories/documento-conductor.repository.postgres';
import { CloudinaryAdapter } from '../external/cloudinary.adapter';
import { UploadDriverDocumentUseCase } from '../../application/use-cases/drivers/upload-driver-document.use-case';
import { DocumentoConductorController } from './controllers/documento-conductor.controller';
import { createDocumentoConductorRoutes } from './routes/documento-conductor.routes';
import { ZonaTarifaRepositoryPostgres } from '../database/repositories/zona-tarifa.repository.postgres';
import { OpenStreetAdapter } from '../external/open-street.adapter';
import { QuoteShipmentUseCase } from '../../application/use-cases/shipments/quote-shipment.use-case';
import { QuoteController } from './controllers/quote.controller';
import { createQuoteRoutes } from './routes/quote.routes';
import { ShipmentRepositoryPostgres } from '../database/repositories/shipment.repository.postgres';
import { CreateShipmentUseCase } from '../../application/use-cases/shipments/create-shipment.use-case';
import { ShipmentController } from './controllers/shipment.controller';
import { createShipmentRoutes } from './routes/shipment.routes';
import { AcceptShipmentUseCase } from '../../application/use-cases/shipments/accept-shipment.use-case';
import { AcceptShipmentController } from './controllers/accept-shipment.controller';
import { createAcceptShipmentRoutes } from './routes/accept-shipment.routes';
import { ShipmentTrackingUseCase } from '../../application/use-cases/shipments/shipment-tracking.use-case';
import { ShipmentTrackingController } from './controllers/shipment-tracking.controller';
import { createShipmentTrackingRoutes } from './routes/shipment-tracking.routes';
import { CalificationUseCase } from '../../application/use-cases/shipments/calification.use-case';
import { CalificationController } from './controllers/calification.controller';
import { DriverApprovalUseCase } from '../../application/use-cases/drivers/driver-approval.use-case';
import { DriverApprovalController } from './controllers/driver-approval.controller';
import { createDriverApprovalRoutes } from './routes/driver-approval.routes';
import { createCalificationRoutes } from './routes/calification.routes';
import { DriverRepositoryPostgres } from '../database/repositories/driver.repository.postgres';
import { DeliveryValidationUseCase } from '../../application/use-cases/shipments/delivery-validation.use-case';
import { DeliveryValidationController } from './controllers/delivery-validation.controller';
import { createDeliveryValidationRoutes } from './routes/delivery-validation.routes';

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// --- Inyección de dependencias (módulo Auth) ---
const hashService = new HashService();
const jwtService = new JWTService();
const userRepository = new UserRepositoryPostgres(pool);
const registerUserUseCase = new RegisterUserUseCase(userRepository, hashService);
const loginUserUseCase = new LoginUserUseCase(userRepository, hashService, jwtService);
const authController = new AuthController(registerUserUseCase, loginUserUseCase);

// --- Inyección de dependencias (módulo Vehículos) ---
const vehicleRepository = new VehicleRepositoryPostgres(pool);
const registerVehicleUseCase = new RegisterVehicleUseCase(vehicleRepository);
const vehicleController = new VehicleController(registerVehicleUseCase);

// --- Inyección de dependencias (módulo Documentos de Conductor) ---
const documentoRepository = new DocumentoConductorRepositoryPostgres(pool);
const cloudinaryAdapter = new CloudinaryAdapter();
const uploadDriverDocumentUseCase = new UploadDriverDocumentUseCase(documentoRepository, cloudinaryAdapter);
const documentoConductorController = new DocumentoConductorController(uploadDriverDocumentUseCase);

// --- Inyección de dependencias (módulo Cotización) ---
const zonaRepository = new ZonaTarifaRepositoryPostgres(pool);
const openStreetAdapter = new OpenStreetAdapter();
const quoteShipmentUseCase = new QuoteShipmentUseCase(zonaRepository, openStreetAdapter);
const quoteController = new QuoteController(quoteShipmentUseCase);

// --- Inyección de dependencias (módulo Envíos) ---
const shipmentRepository = new ShipmentRepositoryPostgres(pool);
const createShipmentUseCase = new CreateShipmentUseCase(shipmentRepository, zonaRepository, openStreetAdapter);
const shipmentController = new ShipmentController(createShipmentUseCase);

// --- Inyección de dependencias (módulo Aceptación de Envíos - RF7) ---
const acceptShipmentUseCase = new AcceptShipmentUseCase(shipmentRepository);
const acceptShipmentController = new AcceptShipmentController(acceptShipmentUseCase);

// --- Inyección de dependencias (módulo Trazabilidad - RF8) ---
const shipmentTrackingUseCase = new ShipmentTrackingUseCase(shipmentRepository);
const shipmentTrackingController = new ShipmentTrackingController(shipmentTrackingUseCase);

// --- Inyección de dependencias (módulo Calificación - RF10) ---
const calificationUseCase = new CalificationUseCase(shipmentRepository);
const calificationController = new CalificationController(calificationUseCase);

// --- Inyección de dependencias (módulo Aprobación de Conductores - RF11) ---
const driverRepository = new DriverRepositoryPostgres(pool);
const driverApprovalUseCase = new DriverApprovalUseCase(driverRepository);
const driverApprovalController = new DriverApprovalController(driverApprovalUseCase);

// --- Inyección de dependencias (módulo Validación de Entrega - RF9) ---
const deliveryValidationUseCase = new DeliveryValidationUseCase(shipmentRepository);
const deliveryValidationController = new DeliveryValidationController(deliveryValidationUseCase);

// Rutas
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'TrackIt Express Backend está funcionando' });
});

app.use('/api/auth', createAuthRoutes(authController));
app.use('/api/vehicles', createVehicleRoutes(vehicleController));
app.use('/api/documentos', createDocumentoConductorRoutes(documentoConductorController));
app.use('/api/cotizar', createQuoteRoutes(quoteController));
app.use('/api/envios', createShipmentRoutes(shipmentController));
app.use('/api/envios', createDeliveryValidationRoutes(deliveryValidationController));
app.use('/api/envios', createCalificationRoutes(calificationController));
app.use('/api/conductores', createDriverApprovalRoutes(driverApprovalController));
app.use('/api/envios', createAcceptShipmentRoutes(acceptShipmentController));
app.use('/api/envios', createShipmentTrackingRoutes(shipmentTrackingController));

// Middleware de manejo de errores
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, statusCode: err.statusCode });
  }
  console.error(err);
  return res.status(500).json({ error: 'Error interno del servidor' });
});

// Iniciar servidor
async function start() {
  try {
    // Verificar conexión a la base de datos antes de aceptar peticiones
    await testConnection();

    app.listen(config.port, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${config.port}`);
      console.log(`📋 Endpoints disponibles:`);
      console.log(`   POST http://localhost:${config.port}/api/auth/register`);
      console.log(`   POST http://localhost:${config.port}/api/auth/login`);
      console.log(`   POST http://localhost:${config.port}/api/vehicles/register`);
      console.log(`   POST http://localhost:${config.port}/api/documentos/upload`);
      console.log(`   POST http://localhost:${config.port}/api/cotizar/cotizar`);
      console.log(`   POST http://localhost:${config.port}/api/envios/crear`);
      console.log(`   POST http://localhost:${config.port}/api/envios/aceptar`);
      console.log(`   GET http://localhost:${config.port}/api/envios/:id`);
      console.log(`   POST http://localhost:${config.port}/api/envios/:id/validar-entrega`);
      console.log(`   POST http://localhost:${config.port}/api/envios/:id/calificar`);
      console.log(`   POST http://localhost:${config.port}/api/conductores/aprobar`);
    });
  } catch (error) {
    console.error('❌ Error iniciando el servidor:', error);
    process.exit(1);
  }
}

start();

export default app;