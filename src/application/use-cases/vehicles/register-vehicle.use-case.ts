import { VehicleRepositoryPort } from '../../../domain/repositories/vehicle.repository.port';
import { RegisterVehicleDTO } from '../../dtos/vehicle.dto';
import { ValidationError, NotFoundError } from '../../../shared/errors';

export class RegisterVehicleUseCase {
  constructor(private vehicleRepository: VehicleRepositoryPort) {}

  async execute(dto: RegisterVehicleDTO): Promise<{ id: number; placa: string; categoria: string }> {
    const existingVehicle = await this.vehicleRepository.findByPlate(dto.placa);
    if (existingVehicle) {
      throw new ValidationError('La placa ya está registrada');
    }

    const conductorExists = await this.vehicleRepository.findConductorById(dto.id_conductor);
    if (!conductorExists) {
      throw new NotFoundError(`No existe un conductor con id ${dto.id_conductor}`);
    }

    const vehicle = await this.vehicleRepository.create({
      placa: dto.placa,
      categoria: dto.categoria as any,
      id_conductor: dto.id_conductor,
    });

    return {
      id: vehicle.id!,
      placa: vehicle.placa,
      categoria: vehicle.categoria,
    };
  }
}