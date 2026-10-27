import { Request, Response } from 'express';
import { RegisterVehicleUseCase } from '../../../application/use-cases/vehicles/register-vehicle.use-case';
import { RegisterVehicleDTO } from '../../../application/dtos/vehicle.dto';

export class VehicleController {
  constructor(private registerVehicleUseCase: RegisterVehicleUseCase) {}

  async register(req: Request, res: Response): Promise<void> {
    const dto: RegisterVehicleDTO = req.body;
    const result = await this.registerVehicleUseCase.execute(dto);
    res.status(201).json({
      message: 'Vehículo registrado exitosamente',
      vehicle: result,
    });
  }
}