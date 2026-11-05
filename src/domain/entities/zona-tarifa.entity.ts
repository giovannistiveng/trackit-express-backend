import { Coordenadas } from './shipment.entity';

/**
 * Zona de cobertura. Es un círculo en el mapa (centro + radio) con un recargo fijo.
 * `tarifa_base` conserva su nombre en la base de datos pero ahora es el recargo de la zona.
 */
export interface ZonaTarifa {
  id_zona?: number;
  nombre_zona: string;
  tarifa_base: number;
  centro?: Coordenadas | null;
  radio_km?: number;
  activa?: boolean;
  descripcion?: string | null;
}
