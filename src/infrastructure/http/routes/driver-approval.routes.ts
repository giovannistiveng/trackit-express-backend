import { Router } from 'express';
import { DriverApprovalController } from '../controllers/driver-approval.controller';

export function createDriverApprovalRoutes(controller: DriverApprovalController): Router {
  const router = Router();

  // POST /api/conductores/aprobar - Aprobar conductor (RF11)
  router.post('/aprobar', (req, res) => {
    controller.approve(req, res);
  });

  return router;
}