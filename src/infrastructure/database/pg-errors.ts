/** 23505 = unique_violation en PostgreSQL. */
export function esViolacionUnica(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}
