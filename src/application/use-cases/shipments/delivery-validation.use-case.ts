import { ShipmentRepositoryPort } from '../../../domain/repositories/shipment.repository.port';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import { DeliveryValidationDTO } from '../../dtos/delivery-validation.dto';

export class DeliveryValidationUseCase {
  constructor(private shipmentRepository: ShipmentRepositoryPort) {}

  async execute(dto: DeliveryValidationDTO): Promise<{ message: string; envio: any }> {
    if (!Number.isInteger(dto.id_envio)) {
      throw new ValidationError('El id del envío no es válido');
    }
    if (!dto.url_foto || typeof dto.url_foto !== 'string') {
      throw new ValidationError('La evidencia fotográfica (url_foto) es obligatoria');
    }

    const envio = await this.shipmentRepository.findById(dto.id_envio);
    if (!envio) {
      throw new NotFoundError(`No existe el envío con id ${dto.id_envio}`);
    }

    if (envio.estado === 'Entregado') {
      throw new ValidationError('Este envío ya ha sido validado como entregado');
    }

    // Validar el PIN contra el almacenado (sin revelarlo en el mensaje de error)
    if (envio.pin_seguridad) {
      if (!dto.pin_seguridad) {
        throw new ValidationError('El PIN de seguridad es obligatorio para validar la entrega');
      }
      if (String(dto.pin_seguridad) !== String(envio.pin_seguridad)) {
        throw new ValidationError('PIN incorrecto');
      }
    }

    // Guarda la evidencia y registra el estado 'Entregado' en el historial
    await this.shipmentRepository.registerDelivery(dto.id_envio, dto.url_foto);

    return {
      message: 'Validación de entrega exitosa',
      envio: {
        id_envio: envio.id_envio,
        estado: 'Entregado',
        origen: envio.origen,
        destino: envio.destino,
        url_foto: dto.url_foto,
      },
    };
  }
}
