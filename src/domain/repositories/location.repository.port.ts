import { Ubicacion } from '../entities/ubicacion.entity';

export interface LocationRepositoryPort {
  /** Guarda la posición; ignora duplicados (mismo envío y mismo instante de captura). */
  save(ubicacion: Ubicacion): Promise<void>;
  findLast(id_envio: number): Promise<Ubicacion | null>;
  /** Recorrido en orden cronológico (las últimas `limite` posiciones). */
  findTrail(id_envio: number, limite: number): Promise<Ubicacion[]>;
}
