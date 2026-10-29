import { Request, Response } from 'express';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import { CalificationUseCase } from '../../../application/use-cases/shipments/calification.use-case';
import { CalificationDTO } from '../../../application/dtos/calification.dto';
import { logger } from '../../../shared/logger';

const log = logger.child('Calificacion');

export class CalificationController {
  constructor(private calificationUseCase: CalificationUseCase) {}

  async calibrate(req: Request, res: Response): Promise<void> {
    try {
      const dto: CalificationDTO = req.body;
      const result = await this.calificationUseCase.execute(dto);
      res.status(200).json({
        message: result.message,
        envio: result.envio,
      });
    } catch (error: any) {
      const where = `${req.method} ${req.originalUrl} id=${req.requestId ?? '-'}`;
      if (error instanceof NotFoundError) {
        log.warn(`${where} → 404 ${error.message}`);
        res.status(404).json({ error: error.message });
      } else if (error instanceof ValidationError) {
        log.warn(`${where} → 400 ${error.message}`);
        res.status(400).json({ error: error.message });
      } else {
        log.error(`${where} → 500 Error no controlado`, error);
        res.status(500).json({ error: 'Error interno del servidor' });
      }
    }
  }
}