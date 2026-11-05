import { Router } from 'express';
import { FrontendLogController } from '../frontend-log.controller';
import { rateLimit } from '../middlewares/rate-limit.middleware';

export function createFrontendLogRoutes(controller: FrontendLogController): Router {
  const router = Router();
  // 30 lotes por minuto por IP (hasta 1.500 eventos/min)
  router.post('/frontend', rateLimit(30, 60_000), (req, res) => controller.receive(req, res));
  return router;
}
