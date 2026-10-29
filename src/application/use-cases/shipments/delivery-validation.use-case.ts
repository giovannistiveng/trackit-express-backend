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

    // Verificar que el envío tenga un conductor asignado (opcional, según negocio)
    if (!envio.id_conductor) {
      throw new ValidationError('No se puede validar la entrega: el envío no tiene conductor asignado');
    }

    // Subir evidencia a Cloudinary (usando el adaptador existente)
    // Not: En un caso real, aquí recibiríamos el file y subiríamos.
    // Por ahora, aceptamos la URL directamente del frontend.
    const url_foto = dto.url_foto;
    if (!url_foto) {
      throw new ValidationError('URL de la foto es requerida para la validación de entrega');
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