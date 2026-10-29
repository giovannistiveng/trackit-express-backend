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
    // Obtener coordenadas de origen y destino usando Nominatim (OpenStreetMap)
    const coordsOrigen = await this.obtenerCoordenadas(origen);
    const coordsDestino = await this.obtenerCoordenadas(destino);

    if (!coordsOrigen || !coordsDestino) {
      throw new Error('No se pudieron geocodificar una o ambas direcciones');
    }

    // Calcular distancia Haversine
    const distanciaKm = this.calcularHaversine(coordsOrigen, coordsDestino);

    // Duración estimada: 30 km/h promedio en zona urbana/rural
    const velocidadPromedioKmh = 30;
    const duracionHoras = distanciaKm / velocidadPromedioKmh;
    const duracionSegundos = duracionHoras * 3600;

    return {
      distancia_km: Math.round(distanciaKm * 100) / 100,
      duracion_segundos: Math.round(duracionSegundos),
    };
  }

  private async obtenerCoordenadas(direccion: string): Promise<Coordenadas | null> {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(direccion)}&limit=1`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept-Language': 'es',
        },
      });

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
      console.error(`Error obteniendo coordenadas para "${direccion}":`, error);
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
}