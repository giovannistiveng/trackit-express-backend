import { Request, Response } from 'express';
import { CreateShipmentUseCase } from '../../../application/use-cases/shipments/create-shipment.use-case';
import { CreateShipmentDTO } from '../../../application/dtos/shipment.dto';

export class ShipmentController {
  constructor(private createShipmentUseCase: CreateShipmentUseCase) {}

  async create(req: Request, res: Response): Promise<void> {
    const dto: CreateShipmentDTO = req.body;
    const result = await this.createShipmentUseCase.execute(dto);
    res.status(201).json({
      message: 'Solicitud de envío creada exitosamente',
      envio: result,
    });
  }
}