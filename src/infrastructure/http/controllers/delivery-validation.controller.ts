import { Request, Response } from 'express';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import { DeliveryValidationUseCase } from '../../../application/use-cases/shipments/delivery-validation.use-case';
import { DeliveryValidationDTO } from '../../../application/dtos/delivery-validation.dto';
import { logger } from '../../../shared/logger';

const log = logger.child('ValidacionEntrega');

export class DeliveryValidationController {
  constructor(private deliveryValidationUseCase: DeliveryValidationUseCase) {}

  async validate(req: Request, res: Response): Promise<void> {
    try {
      const dto: DeliveryValidationDTO = req.body;
      const result = await this.deliveryValidationUseCase.execute(dto);
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