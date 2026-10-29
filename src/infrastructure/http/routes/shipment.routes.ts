import { Router } from 'express';
import { ShipmentController } from '../controllers/shipment.controller';

export function createShipmentRoutes(controller: ShipmentController): Router {
  const router = Router();

  router.post('/crear', (req, res) => controller.create(req, res));

  return router;
}