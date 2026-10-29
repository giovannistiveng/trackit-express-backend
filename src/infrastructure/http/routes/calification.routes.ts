import { Router } from 'express';
import { CalificationController } from '../controllers/calification.controller';

export function createCalificationRoutes(controller: CalificationController): Router {
  const router = Router();

  // POST /api/envios/:id/calificar - Calificar servicio (RF10)
  router.post('/:id/calificar', (req, res) => {
    // El id del envío viene en la URL; la calificación en el body
    req.body = {
      envioId: parseInt(String(req.params.id), 10),
      rating: req.body?.rating,
    };
    controller.calibrate(req, res);
  });

  return router;
}