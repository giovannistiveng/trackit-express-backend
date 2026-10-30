import { Actor } from '../../domain/entities/actor.entity';

declare module 'express-serve-static-core' {
  interface Request {
    /** Id corto de la petición (cabecera X-Request-Id). */
    requestId?: string;
    /** Usuario autenticado (lo coloca el middleware autenticar). */
    actor?: Actor;
  }
}
