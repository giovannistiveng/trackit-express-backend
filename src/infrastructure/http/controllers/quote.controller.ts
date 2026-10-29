import { Request, Response } from 'express';
import { QuoteShipmentUseCase } from '../../../application/use-cases/shipments/quote-shipment.use-case';
import { QuoteShipmentDTO } from '../../../application/dtos/quote.dto';

export class QuoteController {
  constructor(private quoteShipmentUseCase: QuoteShipmentUseCase) {}

  async quote(req: Request, res: Response): Promise<void> {
    const dto: QuoteShipmentDTO = req.body;
    const result = await this.quoteShipmentUseCase.execute(dto);
    res.status(200).json({
      message: 'Tarifa calculada exitosamente',
      ...result,
    });
  }
}