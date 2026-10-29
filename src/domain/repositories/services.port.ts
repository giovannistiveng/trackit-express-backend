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

/** Cálculo de distancia entre dos direcciones (OpenStreetMap en infraestructura). */
export interface DistancePort {
  calcularDistancia(origen: string, destino: string): Promise<ResultadoDistancia>;
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
