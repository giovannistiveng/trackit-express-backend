import { ZonaTarifa } from '../entities/zona-tarifa.entity';

export interface ZonaTarifaRepositoryPort {
  findById(id_zona: number): Promise<ZonaTarifa | null>;
  findAll(): Promise<ZonaTarifa[]>;
  updateTarifa(id_zona: number, tarifa_base: number): Promise<ZonaTarifa | null>;
}
