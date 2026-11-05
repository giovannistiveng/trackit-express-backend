/** 23505 = unique_violation en PostgreSQL. */
export function esViolacionUnica(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/** NUMERIC y otros números llegan de pg como texto; las columnas opcionales, como null. */
export type NumeroPg = string | number | null;

/** Patrón para ILIKE con los comodines del texto escapados ("50%" busca "50%" literal). */
export function patronBusqueda(texto: string): string {
  const escapado = texto.replace(/[\\%_]/g, (c) => '\\' + c);
  return '%' + escapado + '%';
}
