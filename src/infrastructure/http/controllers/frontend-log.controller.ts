import { Request, Response } from 'express';
import { Logger, LogLevel } from '../../../shared/logger';

const NIVELES: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
export const MAX_EVENTOS_POR_LOTE = 50;
const MAX_MENSAJE = 2000;
const MAX_META_JSON = 4000;

export interface EventoFrontend {
  nivel: LogLevel;
  mensaje: string;
  contexto?: string;
  fecha?: string;
  url?: string;
  sesion?: string;
  usuario?: number | string;
  meta?: unknown;
}

function texto(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const limpio = v.replace(/[\r\n]+/g, ' ').trim();
  return limpio ? limpio.slice(0, max) : undefined;
}

/** Valida y normaliza un evento; devuelve null si no es válido. */
export function normalizarEvento(raw: unknown): EventoFrontend | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const nivel = typeof e.nivel === 'string' ? (e.nivel.toUpperCase() as LogLevel) : undefined;
  const mensaje = texto(e.mensaje, MAX_MENSAJE);
  if (!nivel || !NIVELES.includes(nivel) || !mensaje) return null;

  let meta: unknown = undefined;
  if (e.meta !== undefined) {
    try {
      const json = JSON.stringify(e.meta);
      meta = json && json.length <= MAX_META_JSON ? e.meta : '[meta demasiado grande]';
    } catch {
      meta = '[meta no serializable]';
    }
  }

  const usuario = typeof e.usuario === 'number' || typeof e.usuario === 'string' ? e.usuario : undefined;
  return {
    nivel,
    mensaje,
    contexto: texto(e.contexto, 60)?.replace(/[[\]]/g, ''),
    fecha: texto(e.fecha, 40),
    url: texto(e.url, 500),
    sesion: texto(e.sesion, 64),
    usuario: typeof usuario === 'string' ? usuario.slice(0, 40) : usuario,
    meta,
  };
}

/**
 * Recibe lotes de eventos del frontend y los escribe en logs/frontend-AAAA-MM-DD.txt.
 * Los eventos inválidos se descartan sin rechazar el lote completo.
 */
export class FrontendLogController {
  constructor(private readonly log: Logger) {}

  receive(req: Request, res: Response): void {
    const eventos = (req.body as { eventos?: unknown })?.eventos;
    if (!Array.isArray(eventos) || eventos.length === 0) {
      res.status(400).json({ error: 'Se espera { eventos: [...] } con al menos un evento', statusCode: 400 });
      return;
    }
    if (eventos.length > MAX_EVENTOS_POR_LOTE) {
      res.status(400).json({ error: `Máximo ${MAX_EVENTOS_POR_LOTE} eventos por lote`, statusCode: 400 });
      return;
    }

    let recibidos = 0;
    for (const raw of eventos) {
      const ev = normalizarEvento(raw);
      if (!ev) continue;
      recibidos++;
      const ctx = this.log.child(ev.contexto ?? 'App');
      const detalle = {
        fecha_cliente: ev.fecha,
        url: ev.url,
        sesion: ev.sesion,
        usuario: ev.usuario,
        ip: req.ip,
        navegador: texto(req.headers['user-agent'], 200),
        ...(ev.meta !== undefined ? { meta: ev.meta } : {}),
      };
      const metodo = ev.nivel.toLowerCase() as 'debug' | 'info' | 'warn' | 'error';
      ctx[metodo](ev.mensaje, detalle);
    }

    res.status(202).json({ recibidos, descartados: eventos.length - recibidos });
  }
}
