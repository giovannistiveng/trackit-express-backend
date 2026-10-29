import { ZonaTarifaRepositoryPort } from '../../../domain/repositories/zona-tarifa.repository.port';
import { OpenStreetAdapter } from '../../../infrastructure/external/open-street.adapter';
import { QuoteShipmentDTO, QuoteResponse } from '../../dtos/quote.dto';
import { NotFoundError } from '../../../shared/errors';

export class QuoteShipmentUseCase {
  constructor(
    private zonaRepository: ZonaTarifaRepositoryPort,
    private openStreet: OpenStreetAdapter,
  ) {}

  async execute(dto: QuoteShipmentDTO): Promise<QuoteResponse> {
    const zona = await this.zonaRepository.findById(dto.id_zona);
    if (!zona) {
      throw new NotFoundError(`No existe la zona de tarifa con id ${dto.id_zona}`);
    }

    const { distancia_km } = await this.openStreet.calcularDistancia(dto.origen, dto.destino);

    // Tarifa base de la zona + costo por kilómetro (ejemplo: $1000 por km)
    const costoPorKm = 1000;
    const tarifaTotal = zona.tarifa_base + (distancia_km * costoPorKm);

    return {
      distancia_km: Math.round(distancia_km * 100) / 100,
      tarifa_base: zona.tarifa_base,
      tarifa_total: Math.round(tarifaTotal * 100) / 100,
      moneda: 'COP',
    };
  }
}