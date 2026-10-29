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

    // Generar PIN interno de 4 dígitos
    const generatedPin = Math.floor(1000 + Math.random() * 9000).toString();

    // Validar que el PIN coincida (simulación - en caso real el usuario ingresaría el PIN)
    if (dto.pin_seguridad !== generatedPin) {
      throw new ValidationError(`PIN incorrecto. El PIN generado fue: ${generatedPin}`);
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
