import { Request, Response } from 'express';
import { NotFoundError } from '../../../shared/errors';
import { ShipmentTrackingUseCase } from '../../../application/use-cases/shipments/shipment-tracking.use-case';
import { ShipmentTrackingDTO } from '../../../application/dtos/shipment-tracking.dto';
import { logger } from '../../../shared/logger';

const log = logger.child('Trazabilidad');

export class ShipmentTrackingController {
  constructor(private shipmentTrackingUseCase: ShipmentTrackingUseCase) {}

  async tracking(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const result = await this.shipmentTrackingUseCase.execute(Number(id));
      res.status(200).json({
        message: 'Trazabilidad del envío',
        envio: result,
      });
    } catch (error: any) {
      const where = `${req.method} ${req.originalUrl} id=${req.requestId ?? '-'}`;
      if (error instanceof NotFoundError) {
        log.warn(`${where} → 404 ${error.message}`);
        res.status(404).json({ error: error.message });
      } else {
        log.error(`${where} → 500 Error no controlado`, error);
        res.status(500).json({ error: 'Error interno del servidor' });
      }
    }
  }
}