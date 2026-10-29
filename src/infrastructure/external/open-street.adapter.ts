import { config } from '../../config';

export interface Coordenadas {
  lat: number;
  lon: number;
}

export class OpenStreetAdapter {
  private userAgent: string;

  constructor() {
    this.userAgent = 'TrackIt-Express/1.0 (contacto@tuemail.com)';
  }

  async calcularDistancia(origen: string, destino: string): Promise<{ distancia_km: number; duracion_segundos: number }> {
    // Intentar obtener coordenadas reales de OpenStreetMap
    let coordsOrigen: Coordenadas | null = null;
    let coordsDestino: Coordenadas | null = null;

    try {
      coordsOrigen = await this.obtenerCoordenadas(origen);
    } catch (error) {
      console.warn(`No se pudo geocodificar origen "${origen}":`, error);
    }

    try {
      coordsDestino = await this.obtenerCoordenadas(destino);
    } catch (error) {
      console.warn(`No se pudo geocodificar destino "${destino}":`, error);
    }

    // Si ambas coordenadas se obtuvieron, usar distancia real
    if (coordsOrigen && coordsDestino) {
      const distanciaKm = this.calcularHaversine(coordsOrigen, coordsDestino);
      const velocidadPromedioKmh = 30;
      const duracionHoras = distanciaKm / velocidadPromedioKmh;
      const duracionSegundos = duracionHoras * 3600;

      return {
        distancia_km: Math.round(distanciaKm * 100) / 100,
        duracion_segundos: Math.round(duracionSegundos),
      };
    }

    // FALLBACK: distancia simulada basada en las direcciones
    console.warn('Usando distancia simulada (OpenStreetMap no disponible)');
    const distanciaSimulada = this.calcularDistanciaSimulada(origen, destino);
    const duracionSegundos = Math.round(distanciaSimulada * 120); // ~2 min por km

    return {
      distancia_km: distanciaSimulada,
      duracion_segundos: duracionSegundos,
    };
  }

  private async obtenerCoordenadas(direccion: string): Promise<Coordenadas | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8 segundos timeout

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(direccion)}&limit=1`;

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': this.userAgent,
          'Accept-Language': 'es',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Error en Nominatim: ${response.status}`);
      }

      const data = await response.json();

      if (!data || data.length === 0) {
        return null;
      }

      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
      };
    } catch (error) {
      clearTimeout(timeout);
      return null;
    }
  }

  private calcularHaversine(p1: Coordenadas, p2: Coordenadas): number {
    const R = 6371; // Radio de la Tierra en km
    const dLat = this.toRad(p2.lat - p1.lat);
    const dLon = this.toRad(p2.lon - p1.lon);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(p1.lat)) * Math.cos(this.toRad(p2.lat)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(grados: number): number {
    return grados * (Math.PI / 180);
  }

  private calcularDistanciaSimulada(origen: string, destino: string): number {
    const direcciones: Record<string, number> = {
      'casco urbano': 2.5,
      'vereda pekín': 8.5,
      'vereda novillero': 12.0,
      'silvania': 35.0,
      'pasca': 45.0,
      'bogotá': 55.0,
    };

    const origenLower = origen.toLowerCase();
    const destinoLower = destino.toLowerCase();

    let distanciaOrigen = 5;
    let distanciaDestino = 5;

    for (const [clave, distancia] of Object.entries(direcciones)) {
      if (origenLower.includes(clave)) distanciaOrigen = distancia;
      if (destinoLower.includes(clave)) distanciaDestino = distancia;
    }

    return Math.abs(distanciaOrigen - distanciaDestino) + 2;
  }
}
