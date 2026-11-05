import path from 'path';
import { config } from '../../config';
import { Logger, LogLevel } from './logger';

export { Logger, sanitize, formatDate, formatTimestamp } from './logger';
export type { LogLevel, LoggerOptions } from './logger';

const VALID_LEVELS: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

function resolveLevel(): LogLevel {
  const raw = config.log.level as LogLevel;
  if (VALID_LEVELS.includes(raw)) return raw;
  return config.nodeEnv === 'production' ? 'INFO' : 'DEBUG';
}

/**
 * Instancia única del logger para toda la aplicación.
 * Se configura con variables de entorno (ver .env.example):
 *   LOG_DIR, LOG_LEVEL, LOG_RETENTION_DAYS, LOG_TO_CONSOLE
 */
export const logger = new Logger({
  dir: path.resolve(config.log.dir),
  level: resolveLevel(),
  retentionDays: config.log.retentionDays,
  toConsole: config.log.toConsole && config.nodeEnv !== 'test',
});

/**
 * Logger para los eventos que envía el frontend (POST /api/logs/frontend).
 * Escribe en frontend-AAAA-MM-DD.txt, separado de los logs del servidor.
 */
export const frontendLogger = new Logger({
  dir: path.resolve(config.log.dir),
  level: 'DEBUG',
  retentionDays: config.log.retentionDays,
  toConsole: false,
  filePrefix: 'frontend',
  errorFilePrefix: null,
});
