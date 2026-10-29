import { Router } from 'express';
import { ShipmentTrackingController } from '../controllers/shipment-tracking.controller';

export function createShipmentTrackingRoutes(controller: ShipmentTrackingController): Router {
  const router = Router();

  // GET /api/envios/:id - Obtener trazabilidad en tiempo real
  router.get('/:id', (req, res) => controller.tracking(req, res));

  return router;
}