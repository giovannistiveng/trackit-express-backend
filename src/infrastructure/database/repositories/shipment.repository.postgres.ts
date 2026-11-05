import { Pool } from 'pg';
import { Envio, EnvioDetallado, EstadoEnvio } from '../../../domain/entities/shipment.entity';
import { VehicleCategory } from '../../../domain/entities/vehicle.entity';
import { DesgloseTarifa } from '../../../domain/services/tarifas';
import {
  DetallesEditables,
  EnvioAdmin,
  FiltroEnviosAdmin,
  HistorialEstadoRow,
  ResumenConductor,
  ShipmentRepositoryPort,
} from '../../../domain/ports/shipment.repository.port';
import { ANTICIPO_PROGRAMADO_MIN, COMISION_PLATAFORMA } from '../../../domain/entities/shipment.entity';
import { ValidationError } from '../../../shared/errors';
import { NumeroPg, esViolacionUnica, patronBusqueda } from '../pg-utils';

interface EnvioRow {
  id_envio: number;
  origen: string;
  destino: string;
  tipo_carga: string;
  tarifa: string | number;
  pin_seguridad: string | null;
  id_cliente: number;
  id_conductor: number | null;
  id_zona: number;
  categoria: VehicleCategory | null;
  fecha_creacion: Date;
  origen_lat?: NumeroPg;
  origen_lon?: NumeroPg;
  destino_lat?: NumeroPg;
  destino_lon?: NumeroPg;
  distancia_km?: NumeroPg;
  duracion_min?: number | null;
  desglose?: DesgloseTarifa | null;
  notas?: string | null;
  motivo_cancelacion?: string | null;
  metodo_pago?: 'efectivo' | 'nequi';
  token_seguimiento?: string | null;
  destinatario_nombre?: string | null;
  destinatario_telefono?: string | null;
  fecha_programada?: Date | null;
  aviso_programado?: boolean;
  ida_y_vuelta?: boolean;
  destino_visitado_en?: Date | null;
  url_foto_recogida?: string | null;
  fecha_recogida?: Date | null;
  estado: EstadoEnvio;
  fecha_ultimo_cambio?: Date | null;
  calificacion?: NumeroPg;
  comentario?: string | null;
  conductor_nombre?: string | null;
  conductor_placa?: string | null;
  conductor_vehiculo?: string | null;
  conductor_promedio?: NumeroPg;
}

// La tabla Envio no tiene columna "estado": el estado actual es el último registro de Historial_Estado.
const ULTIMO_CAMBIO = `
  LEFT JOIN LATERAL (
    SELECT h.estado, h.fecha_cambio FROM Historial_Estado h
    WHERE h.id_envio = e.id_envio
    ORDER BY h.fecha_cambio DESC, h.id_historial DESC
    LIMIT 1
  ) ult ON TRUE`;

const SELECT_ENVIO = `
  SELECT e.*, COALESCE(ult.estado, 'Pendiente') AS estado, ult.fecha_cambio AS fecha_ultimo_cambio
  FROM Envio e ${ULTIMO_CAMBIO}`;

function coords(lat: NumeroPg | undefined, lon: NumeroPg | undefined) {
  return lat === null || lat === undefined || lon === null || lon === undefined ? null : { lat: Number(lat), lon: Number(lon) };
}

export class ShipmentRepositoryPostgres implements ShipmentRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(envio: Omit<Envio, 'id_envio'>): Promise<Envio> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<EnvioRow>(
        `INSERT INTO Envio (origen, destino, tipo_carga, tarifa, pin_seguridad, id_cliente, id_zona, categoria,
                            origen_lat, origen_lon, destino_lat, destino_lon, distancia_km, notas, duracion_min, desglose,
                            metodo_pago, token_seguimiento, destinatario_nombre, destinatario_telefono, fecha_programada, ida_y_vuelta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
         RETURNING *`,
        [
          envio.origen,
          envio.destino,
          envio.tipo_carga,
          envio.tarifa,
          envio.pin_seguridad,
          envio.id_cliente,
          envio.id_zona,
          envio.categoria ?? null,
          envio.origen_coords?.lat ?? null,
          envio.origen_coords?.lon ?? null,
          envio.destino_coords?.lat ?? null,
          envio.destino_coords?.lon ?? null,
          envio.distancia_km ?? null,
          envio.notas ?? null,
          envio.duracion_min ?? null,
          envio.desglose ? JSON.stringify(envio.desglose) : null,
          envio.metodo_pago ?? 'efectivo',
          envio.token_seguimiento ?? null,
          envio.destinatario_nombre ?? null,
          envio.destinatario_telefono ?? null,
          envio.fecha_programada ?? null,
          envio.ida_y_vuelta ?? false,
        ],
      );
      const row = result.rows[0];
      await client.query('INSERT INTO Historial_Estado (estado, id_envio) VALUES ($1, $2)', ['Pendiente', row.id_envio]);
      await client.query('COMMIT');
      return this.mapRow({ ...row, estado: 'Pendiente' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(id_envio: number): Promise<Envio | null> {
    const result = await this.pool.query<EnvioRow>(`${SELECT_ENVIO} WHERE e.id_envio = $1`, [id_envio]);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async findByClient(id_cliente: number, estados?: EstadoEnvio[]): Promise<EnvioDetallado[]> {
    const result = await this.pool.query<EnvioRow>(
      `SELECT * FROM (
         SELECT e.*, COALESCE(ult.estado, 'Pendiente') AS estado, ult.fecha_cambio AS fecha_ultimo_cambio,
                cal.puntuacion AS calificacion, cal.comentario,
                u.nombre AS conductor_nombre,
                veh.placa AS conductor_placa, veh.categoria AS conductor_vehiculo,
                prom.promedio AS conductor_promedio
         FROM Envio e
         ${ULTIMO_CAMBIO}
         LEFT JOIN Calificacion cal ON cal.id_envio = e.id_envio
         LEFT JOIN Conductor c ON c.id_conductor = e.id_conductor
         LEFT JOIN Usuario u ON u.id_usuario = c.id_usuario
         LEFT JOIN LATERAL (
           SELECT v.placa, v.categoria FROM Vehiculo v WHERE v.id_conductor = c.id_conductor ORDER BY v.id_vehiculo LIMIT 1
         ) veh ON TRUE
         LEFT JOIN LATERAL (
           SELECT ROUND(AVG(ca.puntuacion)::numeric, 1) AS promedio
           FROM Calificacion ca JOIN Envio e2 ON e2.id_envio = ca.id_envio
           WHERE e2.id_conductor = c.id_conductor
         ) prom ON TRUE
         WHERE e.id_cliente = $1
       ) t
       WHERE ($2::text[] IS NULL OR t.estado = ANY($2::text[]))
       ORDER BY COALESCE(t.fecha_ultimo_cambio, t.fecha_creacion) DESC, t.id_envio DESC`,
      [id_cliente, estados ?? null],
    );
    return result.rows.map((row) => this.mapDetallado(row));
  }

  async findByDriver(id_conductor: number, estados?: EstadoEnvio[]): Promise<Envio[]> {
    const result = await this.pool.query<EnvioRow>(
      `SELECT * FROM (${SELECT_ENVIO} WHERE e.id_conductor = $1) t
       WHERE ($2::text[] IS NULL OR t.estado = ANY($2::text[]))
       ORDER BY t.id_envio DESC`,
      [id_conductor, estados ?? null],
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  async findAvailable(categorias?: VehicleCategory[], ahora: Date = new Date()): Promise<Envio[]> {
    // Solo envíos con el pago garantizado (efectivo o Nequi aprobado) y, si son programados,
    // desde una hora antes de la hora pactada
    const result = await this.pool.query<EnvioRow>(
      `SELECT * FROM (${SELECT_ENVIO}) t
       LEFT JOIN Pago p ON p.id_envio = t.id_envio
       WHERE t.estado = 'Pendiente' AND t.id_conductor IS NULL
         AND ($1::text[] IS NULL OR t.categoria IS NULL OR t.categoria = ANY($1::text[]))
         AND (p.id_pago IS NULL OR p.metodo = 'efectivo' OR p.estado = 'aprobado')
         AND (t.fecha_programada IS NULL OR t.fecha_programada <= $2::timestamp + make_interval(mins => $3))
       ORDER BY COALESCE(t.fecha_programada, t.fecha_creacion), t.id_envio`,
      [categorias ?? null, ahora, ANTICIPO_PROGRAMADO_MIN],
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  async findByToken(token: string): Promise<Envio | null> {
    const result = await this.pool.query<EnvioRow>(`${SELECT_ENVIO} WHERE e.token_seguimiento = $1`, [token]);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async updateDetalles(id_envio: number, d: DetallesEditables): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of ['tipo_carga', 'notas', 'destinatario_nombre', 'destinatario_telefono'] as const) {
      if (!(k in d)) continue;
      params.push(d[k] ?? null);
      sets.push(`${k} = $${params.length}`);
    }
    if (sets.length === 0) return;
    params.push(id_envio);
    await this.pool.query(`UPDATE Envio SET ${sets.join(', ')} WHERE id_envio = $${params.length}`, params);
  }

  async registerPickup(id_envio: number, url_foto: string, ahora: Date): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE Envio SET url_foto_recogida = $1, fecha_recogida = $2 WHERE id_envio = $3', [url_foto, ahora, id_envio]);
      await client.query(`INSERT INTO Historial_Estado (estado, id_envio) VALUES ('En Ruta', $1)`, [id_envio]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markDestinationVisited(id_envio: number, ahora: Date): Promise<void> {
    await this.pool.query('UPDATE Envio SET destino_visitado_en = $1 WHERE id_envio = $2 AND destino_visitado_en IS NULL', [ahora, id_envio]);
  }

  async findScheduledToAnnounce(ahora: Date): Promise<Envio[]> {
    const result = await this.pool.query<EnvioRow>(
      `SELECT * FROM (${SELECT_ENVIO}) t
       LEFT JOIN Pago p ON p.id_envio = t.id_envio
       WHERE t.estado = 'Pendiente' AND t.id_conductor IS NULL AND t.aviso_programado = FALSE
         AND t.fecha_programada IS NOT NULL
         AND t.fecha_programada <= $1::timestamp + make_interval(mins => $2)
         AND (p.id_pago IS NULL OR p.metodo = 'efectivo' OR p.estado = 'aprobado')
       LIMIT 50`,
      [ahora, ANTICIPO_PROGRAMADO_MIN],
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  async markScheduledAnnounced(id_envio: number): Promise<void> {
    await this.pool.query('UPDATE Envio SET aviso_programado = TRUE WHERE id_envio = $1', [id_envio]);
  }

  async updateStatus(id_envio: number, estado: EstadoEnvio, id_conductor?: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Asignar conductor solo si el envío aún no tiene uno (evita doble asignación concurrente)
      if (id_conductor) {
        const update = await client.query('UPDATE Envio SET id_conductor = $1 WHERE id_envio = $2 AND id_conductor IS NULL', [
          id_conductor,
          id_envio,
        ]);
        if (update.rowCount === 0) throw new ValidationError('Este envío ya fue tomado por otro conductor');
      }
      await client.query('INSERT INTO Historial_Estado (estado, id_envio) VALUES ($1, $2)', [estado, id_envio]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getStatusHistory(id_envio: number): Promise<HistorialEstadoRow[]> {
    const result = await this.pool.query<{ estado: string; fecha_cambio: Date }>(
      'SELECT estado, fecha_cambio FROM Historial_Estado WHERE id_envio = $1 ORDER BY fecha_cambio DESC, id_historial DESC',
      [id_envio],
    );
    return result.rows.map((row) => ({ estado: row.estado, fecha_cambio: new Date(row.fecha_cambio) }));
  }

  async registerDelivery(id_envio: number, url_foto: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO Evidencia_Entrega (url_foto, id_envio) VALUES ($1, $2)', [url_foto, id_envio]);
      await client.query('INSERT INTO Historial_Estado (estado, id_envio) VALUES ($1, $2)', ['Entregado', id_envio]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      // Evidencia_Entrega.id_envio es UNIQUE
      if (esViolacionUnica(error)) throw new ValidationError('Este envío ya tiene una evidencia de entrega registrada');
      throw error;
    } finally {
      client.release();
    }
  }

  async findCalification(id_envio: number): Promise<number | null> {
    const result = await this.pool.query<{ puntuacion: string }>('SELECT puntuacion FROM Calificacion WHERE id_envio = $1', [id_envio]);
    return result.rows[0] ? Number(result.rows[0].puntuacion) : null;
  }

  async saveCalification(id_envio: number, puntuacion: number, comentario: string | null = null): Promise<void> {
    try {
      await this.pool.query('INSERT INTO Calificacion (puntuacion, comentario, id_envio) VALUES ($1, $2, $3)', [
        puntuacion,
        comentario,
        id_envio,
      ]);
    } catch (error) {
      if (esViolacionUnica(error)) throw new ValidationError('Este envío ya fue calificado');
      throw error;
    }
  }

  async cancel(id_envio: number, motivo: string | null): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Bloquea el envío para que no lo acepten ni lo entreguen mientras se cancela
      await client.query('SELECT id_envio FROM Envio WHERE id_envio = $1 FOR UPDATE', [id_envio]);
      const actual = await client.query<{ estado: string }>(
        `SELECT estado FROM Historial_Estado WHERE id_envio = $1 ORDER BY fecha_cambio DESC, id_historial DESC LIMIT 1`,
        [id_envio],
      );
      const estado = actual.rows[0]?.estado ?? 'Pendiente';
      if (estado === 'Entregado' || estado === 'Cancelado') {
        throw new ValidationError(`El envío ya está ${estado.toLowerCase()} y no se puede cancelar`);
      }
      await client.query('UPDATE Envio SET motivo_cancelacion = $1 WHERE id_envio = $2', [motivo, id_envio]);
      await client.query(`INSERT INTO Historial_Estado (estado, id_envio) VALUES ('Cancelado', $1)`, [id_envio]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findDriverHistory(id_conductor: number, limite: number): Promise<EnvioDetallado[]> {
    const result = await this.pool.query<EnvioRow>(
      `SELECT * FROM (
         SELECT e.*, COALESCE(ult.estado, 'Pendiente') AS estado, ult.fecha_cambio AS fecha_ultimo_cambio,
                cal.puntuacion AS calificacion, cal.comentario
         FROM Envio e
         ${ULTIMO_CAMBIO}
         LEFT JOIN Calificacion cal ON cal.id_envio = e.id_envio
         WHERE e.id_conductor = $1
       ) t
       WHERE t.estado IN ('Entregado', 'Cancelado')
       ORDER BY t.fecha_ultimo_cambio DESC NULLS LAST, t.id_envio DESC
       LIMIT $2`,
      [id_conductor, limite],
    );
    return result.rows.map((row) => this.mapDetallado(row));
  }

  async driverSummary(id_conductor: number): Promise<ResumenConductor> {
    const r = await this.pool.query<{
      completados: string;
      ingresos_total: string | null;
      ingresos_mes: string | null;
      promedio: string | null;
      calificaciones: string;
    }>(
      `SELECT COUNT(*) FILTER (WHERE t.estado = 'Entregado') AS completados,
              SUM(t.tarifa) FILTER (WHERE t.estado = 'Entregado') AS ingresos_total,
              SUM(t.tarifa) FILTER (WHERE t.estado = 'Entregado' AND t.fecha_cambio >= date_trunc('month', CURRENT_TIMESTAMP)) AS ingresos_mes,
              AVG(cal.puntuacion) AS promedio,
              COUNT(cal.id_calificacion) AS calificaciones
       FROM (
         SELECT e.id_envio, e.tarifa, COALESCE(ult.estado, 'Pendiente') AS estado, ult.fecha_cambio
         FROM Envio e ${ULTIMO_CAMBIO}
         WHERE e.id_conductor = $1
       ) t
       LEFT JOIN Calificacion cal ON cal.id_envio = t.id_envio`,
      [id_conductor],
    );
    const row = r.rows[0];
    const neto = (v: string | null) => Math.round(Number(v ?? 0) * (1 - COMISION_PLATAFORMA));
    return {
      completados: Number(row.completados),
      ingresos_total: neto(row.ingresos_total),
      ingresos_mes: neto(row.ingresos_mes),
      calificacion_promedio: row.promedio === null ? null : Math.round(Number(row.promedio) * 10) / 10,
      total_calificaciones: Number(row.calificaciones),
    };
  }

  async searchAdmin(f: FiltroEnviosAdmin): Promise<{ items: EnvioAdmin[]; total: number }> {
    const patron = f.texto ? patronBusqueda(f.texto) : null;
    const idBuscado = f.texto && /^\d+$/.test(f.texto) ? Number(f.texto) : null;
    const result = await this.pool.query<EnvioRow & { cliente_nombre: string; cliente_correo: string; zona_nombre: string; total: string }>(
      `SELECT t.*, COUNT(*) OVER() AS total FROM (
         SELECT e.*, COALESCE(ult.estado, 'Pendiente') AS estado, ult.fecha_cambio AS fecha_ultimo_cambio,
                cli.nombre AS cliente_nombre, cli.correo AS cliente_correo,
                ucon.nombre AS conductor_nombre, z.nombre_zona AS zona_nombre
         FROM Envio e
         ${ULTIMO_CAMBIO}
         JOIN Usuario cli ON cli.id_usuario = e.id_cliente
         JOIN Zona_Tarifa z ON z.id_zona = e.id_zona
         LEFT JOIN Conductor c ON c.id_conductor = e.id_conductor
         LEFT JOIN Usuario ucon ON ucon.id_usuario = c.id_usuario
       ) t
       WHERE ($1::text IS NULL OR t.estado = $1)
         AND ($2::int IS NULL OR t.id_zona = $2)
         AND ($3::text IS NULL OR t.id_envio = $4 OR t.origen ILIKE $3 OR t.destino ILIKE $3
              OR t.cliente_nombre ILIKE $3 OR t.cliente_correo ILIKE $3 OR t.conductor_nombre ILIKE $3)
       ORDER BY COALESCE(t.fecha_ultimo_cambio, t.fecha_creacion) DESC, t.id_envio DESC
       LIMIT $5 OFFSET $6`,
      [f.estado ?? null, f.id_zona ?? null, patron, idBuscado, f.tamano, (f.pagina - 1) * f.tamano],
    );
    return {
      total: result.rows[0] ? Number(result.rows[0].total) : 0,
      items: result.rows.map((row) => ({
        ...this.mapRow(row),
        fecha_ultimo_cambio: row.fecha_ultimo_cambio ? new Date(row.fecha_ultimo_cambio) : undefined,
        cliente_nombre: row.cliente_nombre,
        cliente_correo: row.cliente_correo,
        conductor_nombre: row.conductor_nombre ?? null,
        zona_nombre: row.zona_nombre,
      })),
    };
  }

  private mapRow(row: EnvioRow): Envio {
    return {
      id_envio: row.id_envio,
      origen: row.origen,
      destino: row.destino,
      tipo_carga: row.tipo_carga,
      tarifa: Number(row.tarifa),
      pin_seguridad: row.pin_seguridad ?? undefined,
      id_cliente: row.id_cliente,
      id_conductor: row.id_conductor ?? undefined,
      id_zona: row.id_zona,
      categoria: row.categoria ?? null,
      fecha_creacion: row.fecha_creacion ? new Date(row.fecha_creacion) : undefined,
      origen_coords: coords(row.origen_lat, row.origen_lon),
      destino_coords: coords(row.destino_lat, row.destino_lon),
      distancia_km: row.distancia_km === null || row.distancia_km === undefined ? null : Number(row.distancia_km),
      duracion_min: row.duracion_min ?? null,
      desglose: row.desglose ?? null,
      notas: row.notas ?? null,
      motivo_cancelacion: row.motivo_cancelacion ?? null,
      metodo_pago: row.metodo_pago ?? 'efectivo',
      token_seguimiento: row.token_seguimiento ?? null,
      destinatario_nombre: row.destinatario_nombre ?? null,
      destinatario_telefono: row.destinatario_telefono ?? null,
      fecha_programada: row.fecha_programada ? new Date(row.fecha_programada) : null,
      aviso_programado: row.aviso_programado ?? false,
      ida_y_vuelta: row.ida_y_vuelta ?? false,
      destino_visitado_en: row.destino_visitado_en ? new Date(row.destino_visitado_en) : null,
      url_foto_recogida: row.url_foto_recogida ?? null,
      fecha_recogida: row.fecha_recogida ? new Date(row.fecha_recogida) : null,
      estado: row.estado,
    };
  }

  private mapDetallado(row: EnvioRow): EnvioDetallado {
    return {
      ...this.mapRow(row),
      fecha_ultimo_cambio: row.fecha_ultimo_cambio ? new Date(row.fecha_ultimo_cambio) : undefined,
      calificacion: row.calificacion === null || row.calificacion === undefined ? null : Number(row.calificacion),
      comentario: row.comentario ?? null,
      conductor: row.conductor_nombre
        ? {
            nombre: row.conductor_nombre,
            placa: row.conductor_placa ?? null,
            vehiculo: row.conductor_vehiculo ?? null,
            calificacion_promedio: row.conductor_promedio === null || row.conductor_promedio === undefined ? null : Number(row.conductor_promedio),
          }
        : null,
    };
  }
}
