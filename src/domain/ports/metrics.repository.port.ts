import { EstadisticasPublicas, MetricasAdmin } from '../entities/metricas.entity';

export interface MetricsRepositoryPort {
  dashboard(): Promise<MetricasAdmin>;
  publicas(): Promise<EstadisticasPublicas>;
}
