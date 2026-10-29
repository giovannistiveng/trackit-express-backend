import { Router } from 'express';
import { DeliveryValidationController } from '../controllers/delivery-validation.controller';

export function createDeliveryValidationRoutes(controller: DeliveryValidationController): Router {
  const router = Router();

  // POST /api/envios/:id/validar-entrega - Validar entrega con evidencia fotográfica
  router.post('/:id/validar-entrega', (req, res) => {
    // Incluir el ID de la URL en el body que espera el controller (id_envio)
    req.body = {
      id_envio: parseInt(String(req.params.id), 10),
      url_foto: req.body?.url_foto,
      pin_seguridad: req.body?.pin_seguridad,
    };
    controller.validate(req, res);
  });

  return router;
}