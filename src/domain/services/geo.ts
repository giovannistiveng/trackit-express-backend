import { Coordenadas } from '../entities/shipment.entity';

const RADIO_TIERRA_KM = 6371;
/** Velocidad promedio de un domicilio en la región (vías rurales y casco urbano). */
export const VELOCIDAD_PROMEDIO_KMH = 30;

const rad = (g: number) => (g * Math.PI) / 180;

/** Distancia en línea recta entre dos puntos (km). */
export function haversineKm(a: Coordenadas, b: Coordenadas): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_KM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Minutos estimados para recorrer una distancia. Se aplica un factor 1,3 porque
 * las vías no son rectas, y nunca menos de 1 minuto.
 */
export function minutosEstimados(distanciaKm: number, velocidadKmh = VELOCIDAD_PROMEDIO_KMH): number {
  return Math.max(1, Math.round(((distanciaKm * 1.3) / velocidadKmh) * 60));
}

export function coordenadasValidas(c: Partial<Coordenadas> | null | undefined): c is Coordenadas {
  return (
    !!c &&
    typeof c.lat === 'number' &&
    typeof c.lon === 'number' &&
    Number.isFinite(c.lat) &&
    Number.isFinite(c.lon) &&
    Math.abs(c.lat) <= 90 &&
    Math.abs(c.lon) <= 180
  );
}
