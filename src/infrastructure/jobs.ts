import { Logger } from '../shared/logger';
import { Contenedor } from './container';

export interface Intervalos {
  pagosMs: number;
  programadosMs: number;
  liquidacionesMs: number;
}

export const INTERVALOS: Intervalos = { pagosMs: 15_000, programadosMs: 60_000, liquidacionesMs: 60 * 60_000 };

/**
 * Tareas en segundo plano del servidor:
 *  - cada 15 s consulta los cobros Nequi pendientes (aprobado, rechazado, vencido);
 *  - cada minuto anuncia a los conductores los envíos programados que ya entran al tablero;
 *  - cada hora genera las liquidaciones de la semana anterior (idempotente: solo una vez por semana).
 * Cada tarea evita solaparse consigo misma y un error nunca detiene las demás.
 */
export function iniciarTareas(c: Contenedor, log: Logger, i: Intervalos = INTERVALOS): () => void {
  const enCurso = new Set<string>();
  const tarea = (nombre: string, fn: () => Promise<unknown>) => async () => {
    if (enCurso.has(nombre)) return;
    enCurso.add(nombre);
    try {
      await fn();
    } catch (e) {
      log.warn(`La tarea "${nombre}" falló`, e);
    } finally {
      enCurso.delete(nombre);
    }
  };
  const pagos = tarea('pagos', async () => {
    const n = await c.pagos.procesarPendientes.execute();
    if (n > 0) log.info(`${n} pago(s) Nequi actualizados`);
  });
  const programados = tarea('programados', async () => {
    const n = await c.envios.anunciarProgramados.execute();
    if (n > 0) log.info(`${n} envío(s) programado(s) publicados a los conductores`);
  });
  const liquidaciones = tarea('liquidaciones', async () => {
    const creadas = await c.pagos.generarLiquidaciones.execute(null);
    if (creadas.length > 0) log.info(`${creadas.length} liquidación(es) semanal(es) generadas`);
  });
  const timers = [setInterval(pagos, i.pagosMs), setInterval(programados, i.programadosMs), setInterval(liquidaciones, i.liquidacionesMs)];
  timers.forEach((t) => t.unref());
  void liquidaciones();
  return () => timers.forEach(clearInterval);
}
