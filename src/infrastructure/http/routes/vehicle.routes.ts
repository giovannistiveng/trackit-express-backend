import { Router } from 'express';
import { VehicleController } from '../controllers/vehicle.controller';

export function createVehicleRoutes(controller: VehicleController): Router {
  const router = Router();

  router.post('/register', (req, res) => controller.register(req, res));

  return router;
}