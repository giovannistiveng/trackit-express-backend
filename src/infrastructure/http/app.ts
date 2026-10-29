import cors from 'cors';
import express, { Express } from 'express';
import helmet from 'helmet';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import { config } from '../../config';
import { frontendLogger, Logger } from '../../shared/logger';
import { Contenedor } from '../container';
import { openApiSpec } from './docs/openapi';
import { FrontendLogController } from './frontend-log.controller';
import { manejarErrores, rutaNoEncontrada } from './middlewares/error.middleware';
import { requestLogger } from './middlewares/request-logger.middleware';
import { crearRutasApi } from './routes/api.routes';
import { createFrontendLogRoutes } from './routes/frontend-log.routes';

export interface OpcionesApp {
  contenedor: Contenedor;
  log: Logger;
  /** Verifica la conexión a la base de datos (para /health). */
  salud?: () => Promise<boolean>;
}

/** Crea la aplicación Express sin abrir el puerto (se usa también en las pruebas). */
export function crearApp({ contenedor, log, salud }: OpcionesApp): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // Swagger UI usa estilos y scripts en línea; las imágenes subidas se muestran desde otro origen
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(express.json({ limit: '200kb' }));
  app.use(requestLogger(log.child('HTTP')));

  app.get('/health', async (_req, res) => {
    const db = salud ? await salud().catch(() => false) : true;
    res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degradado', message: 'TrackIt Express Backend', baseDatos: db ? 'ok' : 'sin conexión' });
  });

  // Documentación de la API
  app.get('/api/docs.json', (_req, res) => res.json(openApiSpec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, { customSiteTitle: 'TrackIt Express API' }));

  // Archivos subidos (solo cuando no se usa Cloudinary)
  if (contenedor.storageLocal) {
    app.use('/uploads', express.static(path.resolve(config.uploadsDir), { maxAge: '7d', index: false }));
  }

  app.use('/api/logs', createFrontendLogRoutes(new FrontendLogController(frontendLogger)));
  app.use('/api', crearRutasApi(contenedor));
  app.use('/api', rutaNoEncontrada);
  app.use(manejarErrores(log.child('Servidor')));
  return app;
}
