import { config } from '../../config';
import { pool, testConnection } from '../../config/database';
import { frontendLogger, logger } from '../../shared/logger';
import { crearContenedor } from '../container';
import { crearApp } from './app';
import { iniciarTareas } from '../jobs';

const log = logger.child('Servidor');

const SECRETO_POR_DEFECTO = 'default_secret_change_in_production';

async function start(): Promise<void> {
  if (config.nodeEnv === 'production' && (config.jwt.secret === SECRETO_POR_DEFECTO || config.jwt.secret.length < 32)) {
    log.fatal('JWT_SECRET no está configurado o es demasiado corto (mínimo 32 caracteres) para producción');
    process.exit(1);
  }

  await testConnection();
  const contenedor = crearContenedor({ pool, log });
  const app = crearApp({
    contenedor,
    log,
    salud: async () => {
      await pool.query('SELECT 1');
      return true;
    },
  });

  const server = app.listen(config.port, () => {
    log.info(`Servidor corriendo en http://localhost:${config.port} (entorno: ${config.nodeEnv})`);
    log.info(`Documentación de la API en http://localhost:${config.port}/api/docs`);
    const archivos = contenedor.storageLocal ? `disco local (${config.uploadsDir})` : 'Cloudinary';
    const correo = config.correo.host ? `SMTP ${config.correo.host}` : 'buzón local (logs/correos)';
    log.info(`Archivos: ${archivos} · Logs en ${logger.directory}`);
    log.info(`Pagos: ${contenedor.pasarela} · Correo: ${correo}`);
  });
  const detenerTareas = iniciarTareas(contenedor, log.child('Tareas'));

  // Apagado ordenado: deja de aceptar peticiones, cierra la base de datos y vacía los logs
  const cerrarRecursos = async () => {
    await pool.end().catch(() => undefined);
    await Promise.all([logger.close(), frontendLogger.close()]);
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      log.info(`Señal ${signal} recibida, apagando el servidor`);
      detenerTareas();
      // Las conexiones de eventos (SSE) quedan abiertas: se cierran para poder apagar
      setTimeout(() => server.closeAllConnections(), 2000).unref();
      server.close(() => {
        void cerrarRecursos().finally(() => process.exit(0));
      });
    });
  }
}

// Errores que escapan a Express: se registran antes de que el proceso caiga
process.on('unhandledRejection', (reason) => {
  log.error('Promesa rechazada sin manejar', reason);
});
process.on('uncaughtException', (err) => {
  log.fatal('Excepción no capturada, el servidor se detiene', err);
  process.exit(1);
});

start().catch((error) => {
  log.fatal('Error iniciando el servidor', error);
  process.exit(1);
});
