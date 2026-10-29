/** Cálculo de distancia entre dos direcciones (OpenStreetMap en infraestructura). */
export interface DistancePort {
  calcularDistancia(origen: string, destino: string): Promise<{ distancia_km: number; duracion_segundos: number }>;
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
