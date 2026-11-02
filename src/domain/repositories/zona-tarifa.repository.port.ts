import { ZonaTarifa } from '../entities/zona-tarifa.entity';

export type DatosZona = Omit<ZonaTarifa, 'id_zona'>;

export interface ZonaTarifaRepositoryPort {
  findById(id_zona: number): Promise<ZonaTarifa | null>;
  /** Por defecto solo las zonas activas. */
  findAll(incluirInactivas?: boolean): Promise<ZonaTarifa[]>;
  updateTarifa(id_zona: number, tarifa_base: number): Promise<ZonaTarifa | null>;
  create(zona: DatosZona): Promise<ZonaTarifa>;
  update(id_zona: number, cambios: Partial<DatosZona>): Promise<ZonaTarifa | null>;
}
