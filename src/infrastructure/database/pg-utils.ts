import { Pool, PoolClient } from 'pg';

/** 23505 = unique_violation en PostgreSQL. */
export function esViolacionUnica(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/** NUMERIC y otros números llegan de pg como texto; las columnas opcionales, como null. */
export type NumeroPg = string | number | null;

/** Patrón para ILIKE con los comodines del texto escapados ("50%" busca "50%" literal). */
export function patronBusqueda(texto: string): string {
  const escapado = texto.replaceAll(/[\\%_]/g, (c) => '\\' + c);
  return '%' + escapado + '%';
}

/**
 * Ejecuta `trabajo` dentro de una transacción: COMMIT si termina bien, ROLLBACK y relanza el error
 * si falla. Siempre devuelve la conexión al pool.
 */
export async function enTransaccion<T>(pool: Pool, trabajo: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const resultado = await trabajo(c);
    await c.query('COMMIT');
    return resultado;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

/** Filas afectadas por un UPDATE o DELETE (pg informa null en otras sentencias). */
export function filasAfectadas(r: { rowCount: number | null }): number {
  return r.rowCount ?? 0;
}
