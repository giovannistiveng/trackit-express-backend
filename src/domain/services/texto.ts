/**
 * Convierte a texto un valor que llega sin tipo (JSON, query string). Solo acepta primitivos:
 * un objeto o un arreglo (por ejemplo ?pagina=1&pagina=2) se toma como vacío en lugar de
 * convertirse en "[object Object]".
 */
export function aTexto(valor: unknown): string {
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' || typeof valor === 'boolean' || typeof valor === 'bigint') return String(valor);
  return '';
}

/** Mensaje de un error capturado (en un catch el valor no tiene tipo). */
export function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : aTexto(error);
}
