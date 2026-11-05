import { Pool } from 'pg';
import { MensajeChat } from '../../../domain/entities/chat.entity';
import { EstadoPago, Liquidacion, MovimientoConductor, Pago } from '../../../domain/entities/pago.entity';
import { COMISION_PLATAFORMA, MetodoPago, Parada } from '../../../domain/entities/shipment.entity';
import {
  ChatRepositoryPort,
  FiltroPagos,
  LiquidacionRepositoryPort,
  PagoAdmin,
  PagoRepositoryPort,
  ParadaRepositoryPort,
  PushRepositoryPort,
  SuscripcionPush,
  TipoToken,
  TokenRepositoryPort,
} from '../../../domain/ports/platform.ports';

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const fecha = (v: unknown) => (v ? new Date(v as string) : null);

// ---------------------------------------------------------------- Tokens de cuenta

export class TokenRepositoryPostgres implements TokenRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(id_usuario: number, tipo: TipoToken, token_hash: string, expira: Date): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      // Un enlace nuevo invalida los anteriores del mismo tipo
      await c.query('UPDATE Token_Usuario SET usado_en = CURRENT_TIMESTAMP WHERE id_usuario = $1 AND tipo = $2 AND usado_en IS NULL', [
        id_usuario,
        tipo,
      ]);
      await c.query('INSERT INTO Token_Usuario (id_usuario, tipo, token_hash, expira) VALUES ($1, $2, $3, $4)', [id_usuario, tipo, token_hash, expira]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  async consume(tipo: TipoToken, token_hash: string, ahora: Date): Promise<number | null> {
    const r = await this.pool.query<{ id_usuario: number }>(
      `UPDATE Token_Usuario SET usado_en = $3
       WHERE token_hash = $1 AND tipo = $2 AND usado_en IS NULL AND expira > $3
       RETURNING id_usuario`,
      [token_hash, tipo, ahora],
    );
    return r.rows[0]?.id_usuario ?? null;
  }
}

// ---------------------------------------------------------------- Pagos

interface PagoRow {
  id_pago: number;
  id_envio: number;
  metodo: MetodoPago;
  estado: EstadoPago;
  monto: string;
  telefono: string | null;
  transaccion_id: string | null;
  mensaje: string | null;
  intentos: number;
  creado: Date;
  actualizado: Date;
  aprobado_en: Date | null;
  id_liquidacion: number | null;
}

function mapPago(r: PagoRow): Pago {
  return {
    id_pago: r.id_pago,
    id_envio: r.id_envio,
    metodo: r.metodo,
    estado: r.estado,
    monto: num(r.monto),
    telefono: r.telefono,
    transaccion_id: r.transaccion_id,
    mensaje: r.mensaje,
    intentos: r.intentos,
    creado: new Date(r.creado),
    actualizado: new Date(r.actualizado),
    aprobado_en: fecha(r.aprobado_en),
    id_liquidacion: r.id_liquidacion,
  };
}

const COLUMNAS_PAGO = ['metodo', 'estado', 'monto', 'telefono', 'transaccion_id', 'mensaje', 'intentos', 'aprobado_en', 'id_liquidacion'] as const;

export class PagoRepositoryPostgres implements PagoRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(p: Omit<Pago, 'id_pago'>): Promise<Pago> {
    const r = await this.pool.query<PagoRow>(
      `INSERT INTO Pago (id_envio, metodo, estado, monto, telefono, transaccion_id, mensaje, intentos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [p.id_envio, p.metodo, p.estado, p.monto, p.telefono ?? null, p.transaccion_id ?? null, p.mensaje ?? null, p.intentos ?? 0],
    );
    return mapPago(r.rows[0]);
  }

  async findByEnvio(id_envio: number): Promise<Pago | null> {
    const r = await this.pool.query<PagoRow>('SELECT * FROM Pago WHERE id_envio = $1', [id_envio]);
    return r.rows[0] ? mapPago(r.rows[0]) : null;
  }

  async update(id_envio: number, cambios: Partial<Pago>): Promise<Pago | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const col of COLUMNAS_PAGO) {
      if (!(col in cambios)) continue;
      params.push(cambios[col] ?? null);
      sets.push(`${col} = $${params.length}`);
    }
    params.push(id_envio);
    const r = await this.pool.query<PagoRow>(
      `UPDATE Pago SET ${[...sets, 'actualizado = CURRENT_TIMESTAMP'].join(', ')} WHERE id_envio = $${params.length} RETURNING *`,
      params,
    );
    // El método del envío sigue al del pago
    if (r.rows[0] && cambios.metodo) {
      await this.pool.query('UPDATE Envio SET metodo_pago = $1 WHERE id_envio = $2', [cambios.metodo, id_envio]);
    }
    return r.rows[0] ? mapPago(r.rows[0]) : null;
  }

  async findPendientesNequi(limite: number): Promise<Pago[]> {
    const r = await this.pool.query<PagoRow>(
      `SELECT * FROM Pago WHERE metodo = 'nequi' AND estado = 'pendiente' AND transaccion_id IS NOT NULL
       ORDER BY actualizado LIMIT $1`,
      [limite],
    );
    return r.rows.map(mapPago);
  }

  async search(f: FiltroPagos): Promise<{ items: PagoAdmin[]; total: number }> {
    const r = await this.pool.query<PagoRow & { cliente_nombre: string; origen: string; destino: string; total: string }>(
      `SELECT p.*, u.nombre AS cliente_nombre, e.origen, e.destino, COUNT(*) OVER() AS total
       FROM Pago p JOIN Envio e ON e.id_envio = p.id_envio JOIN Usuario u ON u.id_usuario = e.id_cliente
       WHERE ($1::text IS NULL OR p.metodo = $1) AND ($2::text IS NULL OR p.estado = $2)
       ORDER BY p.actualizado DESC, p.id_pago DESC LIMIT $3 OFFSET $4`,
      [f.metodo ?? null, f.estado ?? null, f.tamano, (f.pagina - 1) * f.tamano],
    );
    return {
      total: r.rows[0] ? Number(r.rows[0].total) : 0,
      items: r.rows.map((x) => ({ ...mapPago(x), cliente_nombre: x.cliente_nombre, origen: x.origen, destino: x.destino })),
    };
  }
}

// ---------------------------------------------------------------- Liquidaciones

interface LiquidacionRow {
  id_liquidacion: number;
  id_conductor: number;
  conductor_nombre?: string;
  desde: Date | string;
  hasta: Date | string;
  servicios: number;
  total_tarifas: string;
  ganancia_conductor: string;
  cobrado_efectivo: string;
  comision_efectivo: string;
  saldo: string;
  estado: 'pendiente' | 'pagada';
  referencia: string | null;
  creada: Date;
  pagada_en: Date | null;
}

/** DATE de Postgres → "AAAA-MM-DD" sin desfase de zona horaria. */
function dia(v: Date | string): string {
  if (typeof v === 'string') return v.slice(0, 10);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
}

function mapLiquidacion(r: LiquidacionRow): Liquidacion {
  return {
    id_liquidacion: r.id_liquidacion,
    id_conductor: r.id_conductor,
    conductor_nombre: r.conductor_nombre,
    desde: dia(r.desde),
    hasta: dia(r.hasta),
    servicios: r.servicios,
    total_tarifas: num(r.total_tarifas),
    ganancia_conductor: num(r.ganancia_conductor),
    cobrado_efectivo: num(r.cobrado_efectivo),
    comision_efectivo: num(r.comision_efectivo),
    saldo: num(r.saldo),
    estado: r.estado,
    referencia: r.referencia,
    creada: new Date(r.creada),
    pagada_en: fecha(r.pagada_en),
  };
}

const SELECT_LIQ = `SELECT l.*, u.nombre AS conductor_nombre FROM Liquidacion l
  JOIN Conductor c ON c.id_conductor = l.id_conductor JOIN Usuario u ON u.id_usuario = c.id_usuario`;

/** Entregas sin liquidar: envío entregado, con pago cobrado (efectivo) o aprobado (Nequi). */
const ENTREGAS_SIN_LIQUIDAR = `
  SELECT e.id_envio, e.id_conductor, e.tarifa, p.metodo, ent.fecha_cambio AS fecha
  FROM Envio e
  JOIN Pago p ON p.id_envio = e.id_envio
  JOIN LATERAL (
    SELECT h.fecha_cambio FROM Historial_Estado h WHERE h.id_envio = e.id_envio AND h.estado = 'Entregado'
    ORDER BY h.fecha_cambio DESC LIMIT 1
  ) ent ON TRUE
  WHERE p.id_liquidacion IS NULL AND NOT p.historico AND p.estado IN ('cobrado', 'aprobado') AND e.id_conductor IS NOT NULL`;

export class LiquidacionRepositoryPostgres implements LiquidacionRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async generar(desde: string, hasta: string): Promise<Liquidacion[]> {
    const c = await this.pool.connect();
    const comision = COMISION_PLATAFORMA;
    try {
      await c.query('BEGIN');
      // Evita que dos procesos generen a la vez (el trabajo programado y el botón del administrador)
      await c.query('SELECT pg_advisory_xact_lock(724001)');
      // Entregas hasta el final del día "hasta" en hora de Colombia. Las columnas TIMESTAMP guardan
      // la hora de la sesión de PostgreSQL: se pasa a hora de Bogotá antes de comparar.
      const entregas = await c.query<{ id_envio: number; id_conductor: number; tarifa: string; metodo: MetodoPago }>(
        `SELECT * FROM (${ENTREGAS_SIN_LIQUIDAR}) t
         WHERE ((t.fecha AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'America/Bogota') < ($1::date + INTERVAL '1 day')`,
        [hasta],
      );
      const porConductor = new Map<number, typeof entregas.rows>();
      for (const e of entregas.rows) porConductor.set(e.id_conductor, [...(porConductor.get(e.id_conductor) ?? []), e]);
      const creadas: Liquidacion[] = [];
      for (const [idConductor, lista] of porConductor) {
        const total = lista.reduce((a, e) => a + num(e.tarifa), 0);
        const ganancia = lista.reduce((a, e) => a + Math.round(num(e.tarifa) * (1 - comision)), 0);
        const efectivo = lista.filter((e) => e.metodo === 'efectivo');
        const cobrado = efectivo.reduce((a, e) => a + num(e.tarifa), 0);
        const comisionEfectivo = efectivo.reduce((a, e) => a + (num(e.tarifa) - Math.round(num(e.tarifa) * (1 - comision))), 0);
        // Nequi: la plataforma recibió el dinero y le debe la ganancia al conductor.
        // Efectivo: el conductor recibió el dinero y le debe la comisión a la plataforma.
        const gananciaNequi = lista.filter((e) => e.metodo === 'nequi').reduce((a, e) => a + Math.round(num(e.tarifa) * (1 - comision)), 0);
        const saldo = gananciaNequi - comisionEfectivo;
        const r = await c.query<LiquidacionRow>(
          `INSERT INTO Liquidacion (id_conductor, desde, hasta, servicios, total_tarifas, ganancia_conductor, cobrado_efectivo, comision_efectivo, saldo, estado)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, CASE WHEN $9::numeric = 0 THEN 'pagada' ELSE 'pendiente' END)
           ON CONFLICT (id_conductor, desde, hasta) DO NOTHING RETURNING *`,
          [idConductor, desde, hasta, lista.length, total, ganancia, cobrado, comisionEfectivo, saldo],
        );
        if (!r.rows[0]) continue;
        await c.query('UPDATE Pago SET id_liquidacion = $1 WHERE id_envio = ANY($2::int[])', [r.rows[0].id_liquidacion, lista.map((e) => e.id_envio)]);
        creadas.push(mapLiquidacion(r.rows[0]));
      }
      await c.query('COMMIT');
      return creadas;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  async list(f: { estado?: 'pendiente' | 'pagada'; id_conductor?: number; pagina: number; tamano: number }) {
    const r = await this.pool.query<LiquidacionRow & { total: string }>(
      `SELECT t.*, COUNT(*) OVER() AS total FROM (${SELECT_LIQ}) t
       WHERE ($1::text IS NULL OR t.estado = $1) AND ($2::int IS NULL OR t.id_conductor = $2)
       ORDER BY t.hasta DESC, t.id_liquidacion DESC LIMIT $3 OFFSET $4`,
      [f.estado ?? null, f.id_conductor ?? null, f.tamano, (f.pagina - 1) * f.tamano],
    );
    return { total: r.rows[0] ? Number(r.rows[0].total) : 0, items: r.rows.map(mapLiquidacion) };
  }

  async findById(id: number): Promise<Liquidacion | null> {
    const r = await this.pool.query<LiquidacionRow>(`${SELECT_LIQ} WHERE l.id_liquidacion = $1`, [id]);
    return r.rows[0] ? mapLiquidacion(r.rows[0]) : null;
  }

  async marcarPagada(id: number, referencia: string, ahora: Date): Promise<Liquidacion | null> {
    const r = await this.pool.query(
      `UPDATE Liquidacion SET estado = 'pagada', referencia = $2, pagada_en = $3 WHERE id_liquidacion = $1 AND estado = 'pendiente'`,
      [id, referencia, ahora],
    );
    return (r.rowCount ?? 0) > 0 ? this.findById(id) : null;
  }

  async movimientosPendientes(id_conductor: number): Promise<MovimientoConductor[]> {
    const r = await this.pool.query<{ id_envio: number; tarifa: string; metodo: MetodoPago; fecha: Date }>(
      `SELECT * FROM (${ENTREGAS_SIN_LIQUIDAR}) t WHERE t.id_conductor = $1 ORDER BY t.fecha DESC LIMIT 200`,
      [id_conductor],
    );
    return r.rows.map((x) => ({
      id_envio: x.id_envio,
      fecha: new Date(x.fecha),
      metodo: x.metodo,
      tarifa: num(x.tarifa),
      ganancia: Math.round(num(x.tarifa) * (1 - COMISION_PLATAFORMA)),
    }));
  }
}

// ---------------------------------------------------------------- Suscripciones push

export class PushRepositoryPostgres implements PushRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(s: SuscripcionPush): Promise<void> {
    await this.pool.query(
      `INSERT INTO Suscripcion_Push (id_usuario, plataforma, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET id_usuario = EXCLUDED.id_usuario, plataforma = EXCLUDED.plataforma,
         p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, creada = CURRENT_TIMESTAMP`,
      [s.id_usuario, s.plataforma, s.endpoint, s.p256dh ?? null, s.auth ?? null],
    );
  }

  async findByUser(id_usuario: number): Promise<SuscripcionPush[]> {
    const r = await this.pool.query<SuscripcionPush>('SELECT * FROM Suscripcion_Push WHERE id_usuario = $1 ORDER BY creada DESC LIMIT 20', [id_usuario]);
    return r.rows;
  }

  async delete(endpoint: string, id_usuario?: number): Promise<void> {
    await this.pool.query('DELETE FROM Suscripcion_Push WHERE endpoint = $1 AND ($2::int IS NULL OR id_usuario = $2)', [endpoint, id_usuario ?? null]);
  }
}

// ---------------------------------------------------------------- Paradas y chat

export class ParadaRepositoryPostgres implements ParadaRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async saveAll(id_envio: number, paradas: Parada[]): Promise<void> {
    for (const p of paradas) {
      await this.pool.query('INSERT INTO Parada_Envio (id_envio, orden, direccion, lat, lon, notas) VALUES ($1, $2, $3, $4, $5, $6)', [
        id_envio,
        p.orden,
        p.direccion,
        p.coords.lat,
        p.coords.lon,
        p.notas ?? null,
      ]);
    }
  }

  async findByEnvio(id_envio: number): Promise<Parada[]> {
    const r = await this.pool.query<{ id_parada: number; orden: number; direccion: string; lat: string; lon: string; notas: string | null; completada_en: Date | null }>(
      'SELECT * FROM Parada_Envio WHERE id_envio = $1 ORDER BY orden',
      [id_envio],
    );
    return r.rows.map((p) => ({
      id_parada: p.id_parada,
      orden: p.orden,
      direccion: p.direccion,
      coords: { lat: num(p.lat), lon: num(p.lon) },
      notas: p.notas,
      completada_en: fecha(p.completada_en),
    }));
  }

  async completar(id_envio: number, id_parada: number, ahora: Date): Promise<boolean> {
    const r = await this.pool.query('UPDATE Parada_Envio SET completada_en = $3 WHERE id_envio = $1 AND id_parada = $2 AND completada_en IS NULL', [
      id_envio,
      id_parada,
      ahora,
    ]);
    return (r.rowCount ?? 0) > 0;
  }
}

export class ChatRepositoryPostgres implements ChatRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(m: Omit<MensajeChat, 'id_mensaje'>): Promise<MensajeChat> {
    const r = await this.pool.query<{ id_mensaje: number; creado: Date }>(
      'INSERT INTO Mensaje_Chat (id_envio, id_usuario, texto) VALUES ($1, $2, $3) RETURNING id_mensaje, creado',
      [m.id_envio, m.id_usuario, m.texto],
    );
    return { ...m, id_mensaje: r.rows[0].id_mensaje, creado: new Date(r.rows[0].creado), leido: false };
  }

  async findByEnvio(id_envio: number, limite: number): Promise<MensajeChat[]> {
    const r = await this.pool.query<{ id_mensaje: number; id_envio: number; id_usuario: number; autor_nombre: string; texto: string; leido: boolean; creado: Date }>(
      `SELECT * FROM (
         SELECT m.*, u.nombre AS autor_nombre FROM Mensaje_Chat m JOIN Usuario u ON u.id_usuario = m.id_usuario
         WHERE m.id_envio = $1 ORDER BY m.creado DESC, m.id_mensaje DESC LIMIT $2
       ) t ORDER BY t.creado, t.id_mensaje`,
      [id_envio, limite],
    );
    return r.rows.map((x) => ({ ...x, creado: new Date(x.creado) }));
  }

  async markRead(id_envio: number, id_lector: number): Promise<number> {
    const r = await this.pool.query('UPDATE Mensaje_Chat SET leido = TRUE WHERE id_envio = $1 AND id_usuario <> $2 AND leido = FALSE', [id_envio, id_lector]);
    return r.rowCount ?? 0;
  }

  async countUnread(id_envio: number, id_lector: number): Promise<number> {
    const r = await this.pool.query<{ n: string }>('SELECT COUNT(*) AS n FROM Mensaje_Chat WHERE id_envio = $1 AND id_usuario <> $2 AND leido = FALSE', [
      id_envio,
      id_lector,
    ]);
    return Number(r.rows[0].n);
  }
}
