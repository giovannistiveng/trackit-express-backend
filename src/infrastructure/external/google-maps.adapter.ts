import { config } from '../../config';

export class GoogleMapsAdapter {
  private apiKey: string;

  constructor() {
    this.apiKey = config.googleMaps.apiKey;
  }

  async calcularDistancia(origen: string, destino: string): Promise<{ distancia_km: number; duracion_segundos: number }> {
    if (!this.apiKey) {
      throw new Error('GOOGLE_MAPS_API_KEY no configurada');
    }

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origen)}&destinations=${encodeURIComponent(destino)}&key=${this.apiKey}&units=metric&language=es`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' || !data.rows?.[0]?.elements?.[0]) {
      throw new Error(`Error calculando distancia: ${data.error_message || 'Respuesta inválida de Google Maps'}`);
    }

    const element = data.rows[0].elements[0];

    if (element.status !== 'OK') {
      throw new Error(`No se pudo calcular la ruta: ${element.status}`);
    }

    return {
      distancia_km: element.distance.value / 1000,
      duracion_segundos: element.duration.value,
    };
  }
}