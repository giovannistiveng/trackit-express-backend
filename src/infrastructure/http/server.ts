import express from 'express';
import cors from 'cors';
import { config } from '../../config';
import { pool } from '../../config/database';
import { AppError } from '../../shared/errors';
import { HashService } from '../security/hash.service';
import { JWTService } from '../security/jwt.service';
import { UserRepositoryPostgres } from '../database/repositories/user.repository.postgres';
import { RegisterUserUseCase } from '../../application/use-cases/auth/register-user.use-case';
import { LoginUserUseCase } from '../../application/use-cases/auth/login-user.use-case';
import { AuthController } from './controllers/auth.controller';
import { createAuthRoutes } from './routes/auth.routes';

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

// Rutas
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'TrackIt Express Backend está funcionando' });
});

app.use('/api/auth', createAuthRoutes(authController));

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
    app.listen(config.port, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${config.port}`);
      console.log(`📋 Endpoints disponibles:`);
      console.log(`   POST http://localhost:${config.port}/api/auth/register`);
      console.log(`   POST http://localhost:${config.port}/api/auth/login`);
    });
  } catch (error) {
    console.error('❌ Error iniciando el servidor:', error);
    process.exit(1);
  }
}

start();

export default app;