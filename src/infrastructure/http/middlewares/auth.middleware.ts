import { NextFunction, Request, Response } from 'express';
import { Actor } from '../../../domain/entities/actor.entity';
import { TokenServicePort } from '../../../domain/repositories/services.port';
import { ForbiddenError, UnauthorizedError } from '../../../shared/errors';

/** Exige un JWT válido en Authorization: Bearer <token> y deja el usuario en req.actor. */
export function autenticar(tokens: TokenServicePort) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const cabecera = req.headers.authorization ?? '';
    const [tipo, token] = cabecera.split(' ');
    if (tipo !== 'Bearer' || !token) return next(new UnauthorizedError('Falta el token de acceso'));
    const payload = tokens.verify(token);
    if (!payload) return next(new UnauthorizedError('Token inválido o vencido'));
    req.actor = { userId: payload.userId, role: Number(payload.role), email: payload.email };
    next();
  };
}

/** Exige uno de los roles dados (1 Administrador, 2 Cliente, 3 Conductor). */
export function autorizar(...roles: number[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.actor) return next(new UnauthorizedError('Falta el token de acceso'));
    if (!roles.includes(req.actor.role)) return next(new ForbiddenError());
    next();
  };
}

/** Usuario autenticado (lanza 401 si una ruta lo usa sin el middleware). */
export function actorDe(req: Request): Actor {
  if (!req.actor) throw new UnauthorizedError('Falta el token de acceso');
  return req.actor;
}
