import { Router } from 'express';
import { AcceptShipmentController } from '../controllers/accept-shipment.controller';

export function createAcceptShipmentRoutes(controller: AcceptShipmentController): Router {
  const router = Router();

  router.post('/aceptar', (req, res) => controller.accept(req, res));

  return router;
}