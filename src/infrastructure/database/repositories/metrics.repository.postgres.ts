import { Pool } from 'pg';
import { MetricasAdmin } from '../../../domain/entities/metricas.entity';
import { MetricsRepositoryPort } from '../../../domain/repositories/metrics.repository.port';

const ESTADO_ACTUAL = `
  SELECT e.id_envio, e.tarifa, e.id_zona, COALESCE(ult.estado, 'Pendiente') AS estado
  FROM Envio e
  LEFT JOIN LATERAL (
    SELECT h.estado FROM Historial_Estado h WHERE h.id_envio = e.id_envio
    ORDER BY h.fecha_cambio DESC, h.id_historial DESC LIMIT 1
  ) ult ON TRUE`;

export class MetricsRepositoryPostgres implements MetricsRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async dashboard(): Promise<MetricasAdmin> {
    const [resumen, conductores, calificacion, porZona, porEstado] = await Promise.all([
      this.pool.query<{ total: string; activos: string; entregados: string; ingresos: string | null }>(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE estado <> 'Entregado') AS activos,
                COUNT(*) FILTER (WHERE estado = 'Entregado') AS entregados,
                SUM(tarifa) FILTER (WHERE estado = 'Entregado') AS ingresos
         FROM (${ESTADO_ACTUAL}) t`,
      ),
      this.pool.query<{ aprobados: string; pendientes: string }>(
        `SELECT COUNT(*) FILTER (WHERE estado_aprobacion = 'Aprobado') AS aprobados,
                COUNT(*) FILTER (WHERE estado_aprobacion = 'Pendiente') AS pendientes
         FROM Conductor`,
      ),
      this.pool.query<{ promedio: string | null }>('SELECT AVG(puntuacion) AS promedio FROM Calificacion'),
      this.pool.query<{ zona: string; envios: string }>(
        `SELECT z.nombre_zona AS zona, COUNT(e.id_envio) AS envios
         FROM Zona_Tarifa z LEFT JOIN Envio e ON e.id_zona = z.id_zona
         GROUP BY z.id_zona, z.nombre_zona ORDER BY z.id_zona`,
      ),
      this.pool.query<{ estado: string; envios: string }>(
        `SELECT estados.estado, COUNT(t.id_envio) AS envios
         FROM (VALUES ('Pendiente', 1), ('Asignado', 2), ('En Ruta', 3), ('Entregado', 4)) AS estados(estado, orden)
         LEFT JOIN (${ESTADO_ACTUAL}) t ON t.estado = estados.estado
         GROUP BY estados.estado, estados.orden ORDER BY estados.orden`,
      ),
    ]);
    const r = resumen.rows[0];
    const prom = calificacion.rows[0].promedio;
    return {
      enviosTotales: Number(r.total),
      enviosActivos: Number(r.activos),
      entregados: Number(r.entregados),
      ingresosCop: Number(r.ingresos ?? 0),
      conductoresAprobados: Number(conductores.rows[0].aprobados),
      conductoresPendientes: Number(conductores.rows[0].pendientes),
      calificacionPromedio: prom === null ? 0 : Math.round(Number(prom) * 10) / 10,
      porZona: porZona.rows.map((z) => ({ zona: z.zona, envios: Number(z.envios) })),
      porEstado: porEstado.rows.map((e) => ({ estado: e.estado, envios: Number(e.envios) })),
    };
  }
}
