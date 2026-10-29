import { NextFunction, Request, Response } from 'express';

/**
 * Límite simple en memoria: máximo `max` peticiones por IP en una ventana de `windowMs`.
 * Suficiente para proteger el endpoint de logs; para varios servidores habría que usar Redis.
 */
export function rateLimit(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const t = now();
    const key = req.ip ?? 'desconocida';
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
      }
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - t) / 1000));
      res.status(429).json({ error: 'Demasiadas peticiones, intenta más tarde', statusCode: 429 });
      return;
    }
    next();
  };
}
