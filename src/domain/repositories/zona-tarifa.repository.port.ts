import { ZonaTarifa } from '../entities/zona-tarifa.entity';

export interface ZonaTarifaRepositoryPort {
  findById(id_zona: number): Promise<ZonaTarifa | null>;
  findAll(): Promise<ZonaTarifa[]>;
}
