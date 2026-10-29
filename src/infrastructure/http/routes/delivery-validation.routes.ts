import { Router } from 'express';
import { DeliveryValidationController } from '../controllers/delivery-validation.controller';

export function createDeliveryValidationRoutes(controller: DeliveryValidationController): Router {
  const router = Router();

  // POST /api/envios/:id/validar-entrega - Validar entrega con evidencia fotográfica
  router.post('/:id/validar-entrega', (req, res) => controller.validate(req, res));

  return router;
}