import { Coordenadas } from '../../domain/entities/shipment.entity';
import { TarifaVehiculo } from '../../domain/entities/tarifa-vehiculo.entity';
import { CATEGORIAS_VEHICULO, VehicleCategory } from '../../domain/entities/vehicle.entity';
import { ZonaTarifa } from '../../domain/entities/zona-tarifa.entity';
import { DistancePort, ResultadoDistancia } from '../../domain/repositories/services.port';
import { TarifaVehiculoRepositoryPort } from '../../domain/repositories/tarifa-vehiculo.repository.port';
import { ZonaTarifaRepositoryPort } from '../../domain/repositories/zona-tarifa.repository.port';
import { coordenadasValidas } from '../../domain/services/geo';
import {
  CATEGORIA_POR_DEFECTO,
  DesgloseTarifa,
  calcularTarifaDetallada,
  esNocturno,
  zonaDelPunto,
} from '../../domain/services/tarifas';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { coordenadasOpcionales, idValido, textoValido } from '../validation';

/** Tarifas de respaldo si la tabla Tarifa_Vehiculo aún no existe o está vacía (migración 003 pendiente). */
export const TARIFAS_POR_DEFECTO: TarifaVehiculo[] = [
  { categoria: 'Moto Express', banderazo: 2000, por_km: 700, por_minuto: 50, minimo: 4500 },
  { categoria: 'Motocarro', banderazo: 4000, por_km: 950, por_minuto: 80, minimo: 8000 },
  { categoria: 'Camioneta', banderazo: 10000, por_km: 1600, por_minuto: 120, minimo: 18000 },
];

export interface SolicitudRuta {
  origen: unknown;
  destino: unknown;
  id_zona?: unknown;
  categoria?: unknown;
  origen_coords?: unknown;
  destino_coords?: unknown;
}

export interface OpcionVehiculo {
  categoria: VehicleCategory;
  tarifa_total: number;
  minimo_aplicado: boolean;
}

export interface Cotizacion {
  origen: string;
  destino: string;
  categoria: VehicleCategory | null;
  zona: ZonaTarifa;
  zonaOrigen: ZonaTarifa | null;
  ruta: ResultadoDistancia;
  minutos: number;
  desglose: DesgloseTarifa;
  opciones: OpcionVehiculo[];
  nocturno: boolean;
}

export function categoriaOpcional(valor: unknown): VehicleCategory | null {
  if (valor === undefined || valor === null || valor === '') return null;
  if (!(CATEGORIAS_VEHICULO as readonly string[]).includes(String(valor))) {
    throw new ValidationError('Categoría inválida. Debe ser: Moto Express, Motocarro o Camioneta');
  }
  return valor as VehicleCategory;
}

/**
 * Calcula el precio de un viaje:
 * 1. Distancia y tiempo por carretera (coordenadas del mapa o dirección buscada).
 * 2. Zona de origen y destino según su ubicación; el recargo es el mayor de los dos.
 * 3. Precio del vehículo (banderazo + km + minutos, con mínimo) + recargo de zona + nocturno.
 */
export class Cotizador {
  constructor(
    private readonly zonas: ZonaTarifaRepositoryPort,
    private readonly tarifas: TarifaVehiculoRepositoryPort,
    private readonly distancia: DistancePort,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async cotizar(input: SolicitudRuta): Promise<Cotizacion> {
    const origen = textoValido(input.origen, 'origen', 3, 200);
    const destino = textoValido(input.destino, 'destino', 3, 200);
    const categoria = categoriaOpcional(input.categoria);
    const conocidoOrigen = coordenadasOpcionales(input.origen_coords, 'origen_coords');
    const conocidoDestino = coordenadasOpcionales(input.destino_coords, 'destino_coords');
    if (origen.toLowerCase() === destino.toLowerCase() && !conocidoOrigen && !conocidoDestino) {
      throw new ValidationError('El origen y el destino deben ser distintos');
    }

    const ruta = await this.distancia.calcularDistancia(origen, destino, { origen: conocidoOrigen, destino: conocidoDestino });
    if (ruta.exacta !== false && ruta.distancia_km < 0.05) {
      throw new ValidationError('El origen y el destino son el mismo lugar');
    }
    const zonas = await this.zonas.findAll();
    const zonaOrigen = this.zonaDe(zonas, ruta.origen, 'origen');
    const zona = this.zonaDe(zonas, ruta.destino, 'destino') ?? (await this.zonaManual(input.id_zona));

    const recargo = Math.max(zona.tarifa_base, zonaOrigen?.tarifa_base ?? 0);
    const minutos = Math.max(1, Math.round(ruta.duracion_segundos / 60));
    const fecha = this.reloj();
    const tarifas = await this.tarifasVigentes();
    const calcular = (t: TarifaVehiculo) =>
      calcularTarifaDetallada({ tarifa: t, distanciaKm: ruta.distancia_km, minutos, recargoZona: recargo, fecha });

    const opciones = tarifas.map((t) => {
      const d = calcular(t);
      return { categoria: t.categoria, tarifa_total: d.total, minimo_aplicado: d.minimo_aplicado };
    });
    const elegida = tarifas.find((t) => t.categoria === (categoria ?? CATEGORIA_POR_DEFECTO)) ?? tarifas[0];
    return {
      origen,
      destino,
      categoria,
      zona,
      zonaOrigen,
      ruta,
      minutos,
      desglose: calcular(elegida),
      opciones,
      nocturno: esNocturno(fecha),
    };
  }

  private zonaDe(zonas: ZonaTarifa[], punto: Coordenadas | null | undefined, cual: 'origen' | 'destino'): ZonaTarifa | null {
    if (!coordenadasValidas(punto)) return null;
    const z = zonaDelPunto(zonas, punto);
    if (!z) {
      throw new ValidationError(
        `La dirección de ${cual} está fuera de nuestra zona de cobertura. Revisa la dirección o elígela en el mapa`,
      );
    }
    return z;
  }

  /** Sin coordenadas del destino, el cliente debe indicar la zona a mano. */
  private async zonaManual(idCrudo: unknown): Promise<ZonaTarifa> {
    if (idCrudo === undefined || idCrudo === null || idCrudo === '') {
      throw new ValidationError('No encontramos la dirección de destino. Elígela en el mapa o selecciona la zona');
    }
    const id = idValido(idCrudo, 'id_zona');
    const zona = await this.zonas.findById(id);
    if (!zona || zona.activa === false) throw new NotFoundError(`No existe la zona de tarifa con id ${id}`);
    return zona;
  }

  private async tarifasVigentes(): Promise<TarifaVehiculo[]> {
    try {
      const t = await this.tarifas.findAll();
      return t.length > 0 ? t : TARIFAS_POR_DEFECTO;
    } catch {
      return TARIFAS_POR_DEFECTO;
    }
  }
}
