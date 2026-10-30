import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { Logger } from '../../../shared/logger';

/**
 * Registra cada petición HTTP al terminar: método, ruta, código, duración, IP e id de petición.
 *   - 2xx/3xx → INFO
 *   - 4xx     → WARN
 *   - 5xx     → ERROR
 * En nivel DEBUG también guarda el cuerpo de la petición, con los datos sensibles ocultos.
 * El id se devuelve en la cabecera X-Request-Id para cruzar una queja del usuario con el log.
 */
export function requestLogger(log: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    const requestId = randomUUID().slice(0, 8);
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const status = res.statusCode;
      const msg = `${req.method} ${req.originalUrl} → ${status} (${ms.toFixed(1)} ms) id=${requestId} ip=${req.ip}`;

      if (status >= 500) log.error(msg);
      else if (status >= 400) log.warn(msg);
      else log.info(msg);

      // El cuerpo de /api/logs ya queda en frontend-*.txt; no se duplica aquí
      const esLog = req.originalUrl.startsWith('/api/logs');
      if (!esLog && req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        log.debug(`Cuerpo de la petición id=${requestId}`, req.body);
      }
    });

    next();
  };
}
