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

// Rutas
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'TrackIt Express Backend está funcionando' });
});

app.use('/api/auth', createAuthRoutes(authController));
app.use('/api/vehicles', createVehicleRoutes(vehicleController));
app.use('/api/documentos', createDocumentoConductorRoutes(documentoConductorController));
app.use('/api/cotizar', createQuoteRoutes(quoteController));

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
    });
  } catch (error) {
    console.error('❌ Error iniciando el servidor:', error);
    process.exit(1);
  }
}

start();

export default app;