import { Coordenadas } from '../entities/shipment.entity';
import { TarifaVehiculo } from '../entities/tarifa-vehiculo.entity';
import { CATEGORIAS_VEHICULO, VehicleCategory } from '../entities/vehicle.entity';
import { ZonaTarifa } from '../entities/zona-tarifa.entity';
import { haversineKm } from './geo';

/** Recargo nocturno (20:00 a 5:59, hora de Colombia). */
export const RECARGO_NOCTURNO = 0.2;
export const HORA_INICIO_NOCHE = 20;
export const HORA_FIN_NOCHE = 6;
/** Los precios se redondean hacia arriba a múltiplos de 100 COP. */
export const REDONDEO_COP = 100;
/** Recargo por cada parada intermedia (el conductor se detiene, entrega o recoge y sigue). */
export const RECARGO_PARADA = 1500;
/** Cuando el cliente no elige vehículo se cotiza con el más económico. */
export const CATEGORIA_POR_DEFECTO: VehicleCategory = 'Moto Express';

/** Capacidad relativa: un vehículo puede llevar pedidos de su categoría o de una menor. */
export const CAPACIDAD: Record<VehicleCategory, number> = { 'Moto Express': 1, Motocarro: 2, Camioneta: 3 };

/** Categorías de pedido que puede atender un conductor con estos vehículos. */
export function categoriasAtendibles(vehiculos: VehicleCategory[]): VehicleCategory[] {
  if (vehiculos.length === 0) return [];
  const max = Math.max(...vehiculos.map((v) => CAPACIDAD[v]));
  return CATEGORIAS_VEHICULO.filter((c) => CAPACIDAD[c] <= max);
}

/** Vehículos que pueden llevar un pedido de esta categoría (sin categoría: todos). */
export function vehiculosQuePuedenLlevar(pedido: VehicleCategory | null): VehicleCategory[] {
  return pedido === null ? [...CATEGORIAS_VEHICULO] : CATEGORIAS_VEHICULO.filter((c) => CAPACIDAD[c] >= CAPACIDAD[pedido]);
}

export function puedeAtender(vehiculos: VehicleCategory[], pedido: VehicleCategory | null): boolean {
  return pedido === null || categoriasAtendibles(vehiculos).includes(pedido);
}

/** Hora (0–23) en Colombia, que no tiene horario de verano (UTC−5). */
export function horaColombia(fecha: Date): number {
  return (fecha.getUTCHours() + 24 - 5) % 24;
}

export function esNocturno(fecha: Date): boolean {
  const h = horaColombia(fecha);
  return h >= HORA_INICIO_NOCHE || h < HORA_FIN_NOCHE;
}

export interface DesgloseTarifa {
  categoria: VehicleCategory;
  banderazo: number;
  distancia: number;
  tiempo: number;
  recargo_zona: number;
  /** Paradas intermedias y su recargo. */
  paradas: number;
  recargo_paradas: number;
  ida_y_vuelta: boolean;
  recargo_nocturno: number;
  /** true si el total subió hasta la tarifa mínima del vehículo. */
  minimo_aplicado: boolean;
  total: number;
}

export interface DatosTarifa {
  tarifa: TarifaVehiculo;
  distanciaKm: number;
  minutos: number;
  recargoZona: number;
  fecha?: Date;
  paradas?: number;
  idaYVuelta?: boolean;
}

const redondear = (v: number) => Math.ceil(v / REDONDEO_COP) * REDONDEO_COP;

/** Calcula el precio de un viaje con su desglose. Todas las partidas quedan en pesos enteros. */
export function calcularTarifaDetallada({
  tarifa,
  distanciaKm,
  minutos,
  recargoZona,
  fecha = new Date(),
  paradas = 0,
  idaYVuelta = false,
}: DatosTarifa): DesgloseTarifa {
  const banderazo = Math.round(tarifa.banderazo);
  const distancia = Math.round(Math.max(0, distanciaKm) * tarifa.por_km);
  const tiempo = Math.round(Math.max(0, minutos) * tarifa.por_minuto);
  const recargo_zona = Math.round(Math.max(0, recargoZona));
  const nParadas = Math.max(0, Math.floor(paradas));
  const recargo_paradas = nParadas * RECARGO_PARADA;
  const base = banderazo + distancia + tiempo;
  const conMinimo = Math.max(base, tarifa.minimo);
  const subtotal = conMinimo + recargo_zona + recargo_paradas;
  const recargo_nocturno = esNocturno(fecha) ? Math.round(subtotal * RECARGO_NOCTURNO) : 0;
  return {
    categoria: tarifa.categoria,
    banderazo,
    distancia,
    tiempo,
    recargo_zona,
    paradas: nParadas,
    recargo_paradas,
    ida_y_vuelta: idaYVuelta,
    recargo_nocturno,
    minimo_aplicado: base < tarifa.minimo,
    total: redondear(subtotal + recargo_nocturno),
  };
}

/** Zona activa más pequeña que contiene el punto, o null si está fuera de cobertura. */
export function zonaDelPunto(zonas: ZonaTarifa[], punto: Coordenadas): ZonaTarifa | null {
  const candidatas = zonas.filter(
    (z) => z.activa !== false && z.centro && haversineKm(z.centro, punto) <= (z.radio_km ?? 0),
  );
  candidatas.sort((a, b) => (a.radio_km ?? 0) - (b.radio_km ?? 0));
  return candidatas[0] ?? null;
}
