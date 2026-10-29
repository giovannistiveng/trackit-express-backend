import { ShipmentRepositoryPort } from '../../../domain/repositories/shipment.repository.port';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import { CalificationDTO } from '../../dtos/calification.dto';

export class CalificationUseCase {
  constructor(private shipmentRepository: ShipmentRepositoryPort) {}

  async execute(dto: CalificationDTO): Promise<{ message: string; envio: any }> {
    if (!Number.isInteger(dto.envioId)) {
      throw new ValidationError('El id del envío no es válido');
    }

    const rating = Number(dto.rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new ValidationError('La calificación debe estar entre 1 y 5 estrellas');
    }

    const envio = await this.shipmentRepository.findById(dto.envioId);
    if (!envio) {
      throw new NotFoundError(`No existe el envío con id ${dto.envioId}`);
    }

    // Solo se puede calificar un servicio ya finalizado
    if (envio.estado !== 'Entregado') {
      throw new ValidationError('Solo se pueden calificar envíos que ya fueron entregados');
    }

    // Un envío solo se califica una vez (Calificacion.id_envio es UNIQUE)
    const existente = await this.shipmentRepository.findCalification(dto.envioId);
    if (existente !== null) {
      throw new ValidationError('Este envío ya fue calificado');
    }

    await this.shipmentRepository.saveCalification(dto.envioId, rating);

    return {
      message: 'Calificación registrada exitosamente',
      envio: {
        id_envio: envio.id_envio,
        calificacion: rating,
        estado: envio.estado,
      },
    };
  }
}
