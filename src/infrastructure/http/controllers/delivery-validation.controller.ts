import { Request, Response } from 'express';
import { DeliveryValidationUseCase } from '../../../application/use-cases/shipments/delivery-validation.use-case';
import { DeliveryValidationDTO } from '../../../application/dtos/delivery-validation.dto';

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
      if (error instanceof NotFoundError) {
        res.status(404).json({ error: error.message });
      } else if (error instanceof ValidationError) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Error interno del servidor' });
      }
    }
  }
}