import { Request, Response } from 'express';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import { DriverApprovalUseCase } from '../../../application/use-cases/drivers/driver-approval.use-case';
import { DriverApprovalDTO } from '../../../application/dtos/driver-approval.dto';

export class DriverApprovalController {
  constructor(private driverApprovalUseCase: DriverApprovalUseCase) {}

  async approve(req: Request, res: Response): Promise<void> {
    try {
      const dto: DriverApprovalDTO = req.body;
      const result = await this.driverApprovalUseCase.execute(dto);
      res.status(200).json({
        message: result.message,
        driver: result.driver,
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