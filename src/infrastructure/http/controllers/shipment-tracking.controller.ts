import { Request, Response } from 'express';
import { NotFoundError } from '../../../shared/errors';
import { ShipmentTrackingUseCase } from '../../../application/use-cases/shipments/shipment-tracking.use-case';
import { ShipmentTrackingDTO } from '../../../application/dtos/shipment-tracking.dto';

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
      if (error instanceof NotFoundError) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Error interno del servidor' });
      }
    }
  }
}