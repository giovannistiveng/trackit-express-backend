import { ZonaTarifa } from '../../../domain/entities/zona-tarifa.entity';
import { CATEGORIAS_VEHICULO, VehicleCategory } from '../../../domain/entities/vehicle.entity';
import { ZonaTarifaRepositoryPort } from '../../../domain/repositories/zona-tarifa.repository.port';
import { DistancePort } from '../../../domain/repositories/services.port';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import { idValido, textoValido } from '../../validation';

export const COSTO_POR_KM = 1000;

/** Zonas de tarifa disponibles. */
export class ListZonesUseCase {
  constructor(private readonly zonas: ZonaTarifaRepositoryPort) {}

  execute(): Promise<ZonaTarifa[]> {
    return this.zonas.findAll();
  }
}

export interface QuoteInput {
  origen: unknown;
  destino: unknown;
  id_zona: unknown;
}

export interface QuoteResponse {
  distancia_km: number;
  tarifa_base: number;
  tarifa_total: number;
  moneda: 'COP';
}

/** Valida origen, destino y zona; lanza 400/404 si algo no cuadra. */
export async function validarRuta(zonas: ZonaTarifaRepositoryPort, input: QuoteInput) {
  const origen = textoValido(input.origen, 'origen', 3, 200);
  const destino = textoValido(input.destino, 'destino', 3, 200);
  if (origen.toLowerCase() === destino.toLowerCase()) {
    throw new ValidationError('El origen y el destino deben ser distintos');
  }
  const idZona = idValido(input.id_zona, 'id_zona');
  const zona = await zonas.findById(idZona);
  if (!zona) throw new NotFoundError(`No existe la zona de tarifa con id ${idZona}`);
  return { origen, destino, zona };
}

export function categoriaOpcional(valor: unknown): VehicleCategory | null {
  if (valor === undefined || valor === null || valor === '') return null;
  if (!(CATEGORIAS_VEHICULO as readonly string[]).includes(String(valor))) {
    throw new ValidationError('Categoría inválida. Debe ser: Moto Express, Motocarro o Camioneta');
  }
  return valor as VehicleCategory;
}

/** Tarifa = base de la zona + distancia × 1.000 COP, redondeada a dos decimales. */
export function calcularTarifa(tarifaBase: number, distanciaKm: number): number {
  return Math.round((tarifaBase + distanciaKm * COSTO_POR_KM) * 100) / 100;
}

/** CU-005: cotización de tarifa. */
export class QuoteShipmentUseCase {
  constructor(
    private readonly zonas: ZonaTarifaRepositoryPort,
    private readonly distancia: DistancePort,
  ) {}

  async execute(input: QuoteInput): Promise<QuoteResponse> {
    const { origen, destino, zona } = await validarRuta(this.zonas, input);
    const { distancia_km } = await this.distancia.calcularDistancia(origen, destino);
    return {
      distancia_km: Math.round(distancia_km * 100) / 100,
      tarifa_base: zona.tarifa_base,
      tarifa_total: calcularTarifa(zona.tarifa_base, distancia_km),
      moneda: 'COP',
    };
  }
}
