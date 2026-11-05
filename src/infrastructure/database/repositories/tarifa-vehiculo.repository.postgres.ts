import { Pool } from 'pg';
import { TarifaVehiculo } from '../../../domain/entities/tarifa-vehiculo.entity';
import { CATEGORIAS_VEHICULO, VehicleCategory } from '../../../domain/entities/vehicle.entity';
import { TarifaVehiculoRepositoryPort } from '../../../domain/ports/tarifa-vehiculo.repository.port';

interface TarifaRow {
  categoria: VehicleCategory;
  banderazo: string | number;
  por_km: string | number;
  por_minuto: string | number;
  minimo: string | number;
}

export class TarifaVehiculoRepositoryPostgres implements TarifaVehiculoRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async findAll(): Promise<TarifaVehiculo[]> {
    const result = await this.pool.query<TarifaRow>('SELECT * FROM Tarifa_Vehiculo');
    return result.rows
      .map((r) => this.mapRow(r))
      .sort((a, b) => CATEGORIAS_VEHICULO.indexOf(a.categoria) - CATEGORIAS_VEHICULO.indexOf(b.categoria));
  }

  async update(categoria: VehicleCategory, t: Omit<TarifaVehiculo, 'categoria'>): Promise<TarifaVehiculo | null> {
    const result = await this.pool.query<TarifaRow>(
      `INSERT INTO Tarifa_Vehiculo (categoria, banderazo, por_km, por_minuto, minimo, actualizado)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       ON CONFLICT (categoria) DO UPDATE SET banderazo = EXCLUDED.banderazo, por_km = EXCLUDED.por_km,
         por_minuto = EXCLUDED.por_minuto, minimo = EXCLUDED.minimo, actualizado = CURRENT_TIMESTAMP
       RETURNING *`,
      [categoria, t.banderazo, t.por_km, t.por_minuto, t.minimo],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  private mapRow(r: TarifaRow): TarifaVehiculo {
    return {
      categoria: r.categoria,
      banderazo: Number(r.banderazo),
      por_km: Number(r.por_km),
      por_minuto: Number(r.por_minuto),
      minimo: Number(r.minimo),
    };
  }
}
