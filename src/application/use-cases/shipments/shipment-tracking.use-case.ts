import { ShipmentRepositoryPort } from '../../../domain/repositories/shipment.repository.port';
import { NotFoundError } from '../../../shared/errors';
import { ShipmentTrackingDTO } from '../../dtos/shipment-tracking.dto';

export class ShipmentTrackingUseCase {
  constructor(private shipmentRepository: ShipmentRepositoryPort) {}

  async execute(id_envio: number): Promise<ShipmentTrackingDTO> {
    // Buscar el envío con su estado actual (incluye último estado de Historial_Estado)
    const envio = await this.shipmentRepository.findById(id_envio);
    if (!envio) {
      throw new NotFoundError(`No existe el envío con id ${id_envio}`);
    }

    // Obtener el historial completo de cambios de estado usando query directa
    // La tabla Envio no tiene columna created_at nativa; el estado actual es el último
    // registro de Historial_Estado. Si no hay historial, se considera 'Pendiente'.
    const { pool } = this.shipmentRepository;
    const client = await pool.connect();
    try {
      const historial = await client.query(
        'SELECT estado, fecha_cambio FROM Historial_Estado WHERE id_envio = $1 ORDER BY fecha_cambio DESC, id_historial DESC',
        [id_envio]
      );

      // Calcular el tiempo en estado actual
      const ultimoEstado = historial.rows[0]?.estado || 'Pendiente';
      // Si hay historial, usar la fecha del último cambio; si no, usar fecha actual
      const fechaUltimoCambio = historial.rows[0]?.fecha_cambio 
        ? new Date(historial.rows[0].fecha_cambio) 
        : new Date();

      // Formatear fecha para la respuesta
      const fechaFormateada = fechaUltimoCambio.toISOString();

      return {
        id_envio: envio.id_envio,
        origen: envio.origen,
        destino: envio.destino,
        tipo_carga: envio.tipo_carga,
        tarifa: envio.tarifa,
        pin_seguridad: envio.pin_seguridad,
        estado: envio.estado,
        id_cliente: envio.id_cliente,
        id_conductor: envio.id_conductor,
        id_zona: envio.id_zona,
        ultimo_cambio_estado: ultimoEstado,
        fecha_ultimo_cambio: fechaFormateada,
        historial_estado: historial.rows.map(h => ({
          estado: h.estado,
          fecha: new Date(h.fecha_cambio).toISOString()
        }))
      };
    } finally {
      client.release();
    }
  }
}