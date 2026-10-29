import { ShipmentRepositoryPort } from '../../../domain/repositories/shipment.repository.port';
import { AcceptShipmentDTO } from '../../dtos/accept-shipment.dto';
import { NotFoundError, ValidationError } from '../../../shared/errors';

export class AcceptShipmentUseCase {
  constructor(private shipmentRepository: ShipmentRepositoryPort) {}

  async execute(dto: AcceptShipmentDTO): Promise<any> {
    // Verificar que el envío exista
    const envio = await this.shipmentRepository.findById(dto.id_envio);
    if (!envio) {
      throw new NotFoundError(`No existe el envío con id ${dto.id_envio}`);
    }

    // Verificar que el envío esté en estado Pendiente
    if (envio.estado !== 'Pendiente') {
      throw new ValidationError(`El envío ya está en estado ${envio.estado} y no se puede asignar`);
    }

    // Verificar que no tenga conductor asignado
    if (envio.id_conductor) {
      throw new ValidationError('Este envío ya tiene un conductor asignado');
    }

    // Asignar el conductor y cambiar estado a Asignado
    await this.shipmentRepository.updateStatus(dto.id_envio, 'Asignado', dto.id_conductor);

    // Obtener el envío actualizado
    const envioActualizado = await this.shipmentRepository.findById(dto.id_envio);
    if (!envioActualizado) {
      throw new NotFoundError('Error al actualizar el envío');
    }

    return {
      id_envio: envioActualizado.id_envio!,
      origen: envioActualizado.origen,
      destino: envioActualizado.destino,
      tipo_carga: envioActualizado.tipo_carga,
      tarifa: envioActualizado.tarifa,
      pin_seguridad: envioActualizado.pin_seguridad!,
      estado: envioActualizado.estado,
      id_cliente: envioActualizado.id_cliente,
      id_conductor: envioActualizado.id_conductor,
      id_zona: envioActualizado.id_zona,
    };
  }
}