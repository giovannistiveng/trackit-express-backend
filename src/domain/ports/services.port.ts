import { Coordenadas } from '../entities/shipment.entity';

export interface ResultadoDistancia {
  distancia_km: number;
  duracion_segundos: number;
  /** Coordenadas geocodificadas, si se pudieron obtener. */
  origen?: Coordenadas | null;
  destino?: Coordenadas | null;
  /** false si la distancia es una estimación porque no se encontraron las direcciones. */
  exacta?: boolean;
}

/** Coordenadas ya conocidas (elegidas en el mapa o por GPS): evitan geocodificar el texto. */
export interface PuntosConocidos {
  origen?: Coordenadas | null;
  destino?: Coordenadas | null;
}

/** Cálculo de distancia por carretera entre dos direcciones (OpenStreetMap + OSRM en infraestructura). */
export interface DistancePort {
  calcularDistancia(origen: string, destino: string, conocidos?: PuntosConocidos): Promise<ResultadoDistancia>;
}

export interface SugerenciaDireccion {
  /** Texto corto para mostrar y guardar ("Cra. 6 #8-20, Fusagasugá"). */
  nombre: string;
  /** Texto completo devuelto por el geocodificador. */
  detalle: string;
  coords: Coordenadas;
}

/** Búsqueda de direcciones en la región de cobertura. */
export interface GeocodingPort {
  buscar(texto: string): Promise<SugerenciaDireccion[]>;
  inversa(punto: Coordenadas): Promise<SugerenciaDireccion | null>;
}

export interface PasswordHasherPort {
  hash(password: string): Promise<string>;
  compare(password: string, hash: string): Promise<boolean>;
}

export interface TokenPayload {
  userId: number;
  email: string;
  role: string;
}

export interface TokenServicePort {
  sign(payload: TokenPayload): string;
  verify(token: string): TokenPayload | null;
}
