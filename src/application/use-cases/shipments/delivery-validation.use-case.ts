import { ShipmentRepositoryPort } from '../../../domain/repositories/shipment.repository.port';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import { DeliveryValidationDTO } from '../../dtos/delivery-validation.dto';

export class DeliveryValidationUseCase {
  constructor(private shipmentRepository: ShipmentRepositoryPort) {}

  async execute(dto: DeliveryValidationDTO): Promise<{ message: string; envio: any }> {
    // Buscar el envío
    const envio = await this.shipmentRepository.findById(dto.id_envio);
    if (!envio) {
      throw new NotFoundError(`No existe el envío con id ${dto.id_envio}`);
    }

    // Verificar que el envío no ya esté entregado
    if (envio.estado === 'Entregado') {
      throw new ValidationError('Este envío ya ha sido validado como entregado');
    }

    // Validar el PIN contra el almacenado en la base de datos
    if (dto.pin_seguridad !== envio.pin_seguridad) {
      throw new ValidationError(`PIN incorrecto. El PIN almacenado es: ${envio.pin_seguridad}`);
    }

    // Actualizar estado a "Entregado" y registrar en historial
    await this.shipmentRepository.updateStatus(dto.id_envio, 'Entregado');

    return {
      message: 'Validación de entrega exitosa',
      envio: {
        id_envio: envio.id_envio,
        estado: 'Entregado',
        origen: envio.origen,
        destino: envio.destino,
      }
    };
  }
}
