import { Request, Response } from 'express';
import { AcceptShipmentUseCase } from '../../../application/use-cases/shipments/accept-shipment.use-case';
import { AcceptShipmentDTO } from '../../../application/dtos/accept-shipment.dto';

export class AcceptShipmentController {
  constructor(private acceptShipmentUseCase: AcceptShipmentUseCase) {}

  async accept(req: Request, res: Response): Promise<void> {
    const dto: AcceptShipmentDTO = req.body;
    const result = await this.acceptShipmentUseCase.execute(dto);
    res.status(200).json({
      message: 'Servicio asignado exitosamente',
      envio: result,
    });
  }
}