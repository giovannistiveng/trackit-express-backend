import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';

export function createAuthRoutes(controller: AuthController): Router {
  const router = Router();

  router.post('/register', (req, res) => controller.register(req, res));
  router.post('/login', (req, res) => controller.login(req, res));

  return router;
}