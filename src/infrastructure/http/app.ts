import cors from 'cors';
import express, { Express } from 'express';
import helmet from 'helmet';
import path from 'node:path';
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
  /** Comprueba la base de datos para /health. */
  salud: () => Promise<boolean>;
}

/** Crea la aplicación Express sin abrir el puerto (se usa también en las pruebas). */
/**
 * ¿Se permite este origen por CORS? Los configurados en CORS_ORIGINS o, sin lista (desarrollo),
 * cualquiera. Las peticiones sin cabecera Origin (curl, la app móvil) no pasan por CORS.
 */
export function origenPermitido(lista: string[], origen: string | undefined): boolean {
  return lista.length === 0 || !origen || lista.includes(origen);
}

export function crearApp({ contenedor, log, salud }: OpcionesApp): Express {
  const app = express();
  app.disable('x-powered-by');
  // Proxies delante de la API (Nginx = 1; Caddy + Nginx = 2): así req.ip es la IP real del usuario
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      // La API solo responde JSON; la única página es Swagger UI, que usa estilos en línea
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: (origen, responder) => responder(null, origenPermitido(config.corsOrigins, origen)),
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(express.json({ limit: '200kb' }));
  // Sin cuerpo (o sin JSON) req.body queda undefined en Express 5: las rutas reciben siempre un objeto
  app.use((req, _res, next) => {
    req.body ??= {};
    next();
  });
  app.use(requestLogger(log.child('HTTP')));

  app.get('/health', async (_req, res) => {
    const db = await salud().catch(() => false);
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
