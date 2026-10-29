import { DriverRepositoryPort } from '../../../domain/repositories/driver.repository.port';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import { DriverApprovalDTO } from '../../dtos/driver-approval.dto';

export class DriverApprovalUseCase {
  constructor(private driverRepository: DriverRepositoryPort) {}

  async execute(dto: DriverApprovalDTO): Promise<{ message: string; driver: any }> {
    if (!Number.isInteger(dto.driverId)) {
      throw new ValidationError('El id del conductor no es válido');
    }
    if (typeof dto.approved !== 'boolean') {
      throw new ValidationError('El campo "approved" debe ser true o false');
    }

    const driver = await this.driverRepository.findById(dto.driverId);
    if (!driver) {
      throw new NotFoundError(`No existe el conductor con id ${dto.driverId}`);
    }

    if (driver.estado_aprobacion === 'Aprobado') {
      throw new ValidationError('Este conductor ya ha sido aprobado previamente');
    }

    const nuevoEstado = dto.approved ? 'Aprobado' : 'Rechazado';
    await this.driverRepository.updateApprovalStatus(driver.id_conductor, nuevoEstado);

    return {
      message: dto.approved ? 'Conductor aprobado exitosamente' : 'Conductor rechazado exitosamente',
      driver: {
        id_conductor: driver.id_conductor,
        nombre: driver.nombre,
        correo: driver.correo,
        estado_aprobacion: nuevoEstado,
      },
    };
  }
}
