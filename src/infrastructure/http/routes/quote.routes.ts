import { Router } from 'express';
import { QuoteController } from '../controllers/quote.controller';

export function createQuoteRoutes(controller: QuoteController): Router {
  const router = Router();

  router.post('/cotizar', (req, res) => controller.quote(req, res));

  return router;
}