import { ShipmentRepositoryPort } from '../../../domain/repositories/shipment.repository.port';
import { NotFoundError } from '../../../shared/errors';
import { ShipmentTrackingDTO } from '../../dtos/shipment-tracking.dto';

export class ShipmentTrackingUseCase {
  constructor(private shipmentRepository: ShipmentRepositoryPort) {}

  async execute(id_envio: number): Promise<ShipmentTrackingDTO> {
    // Envío con su estado actual (último registro de Historial_Estado)
    const envio = await this.shipmentRepository.findById(id_envio);
    if (!envio) {
      throw new NotFoundError(`No existe el envío con id ${id_envio}`);
    }

    // Historial completo (el repositorio lo devuelve del más reciente al más antiguo)
    const historial = await this.shipmentRepository.getStatusHistory(id_envio);

    const ultimo = historial[0];
    const ultimoEstado = ultimo?.estado ?? 'Pendiente';
    const fechaUltimoCambio = ultimo?.fecha_cambio ?? new Date();

    return {
      id_envio,
      origen: envio.origen,
      destino: envio.destino,
      tipo_carga: envio.tipo_carga,
      tarifa: envio.tarifa,
      pin_seguridad: envio.pin_seguridad,
      estado: envio.estado ?? 'Pendiente',
      id_cliente: envio.id_cliente,
      id_conductor: envio.id_conductor,
      id_zona: envio.id_zona,
      ultimo_cambio_estado: ultimoEstado,
      fecha_ultimo_cambio: fechaUltimoCambio.toISOString(),
      historial_estado: historial.map((h) => ({
        estado: h.estado,
        fecha: h.fecha_cambio.toISOString(),
      })),
    };
  }
}
