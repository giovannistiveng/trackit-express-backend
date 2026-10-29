import { ValidationError } from '../shared/errors';

/** Entero positivo o error 400 con el nombre del campo. */
export function idValido(valor: unknown, campo: string): number {
  const n = typeof valor === 'string' && /^\d+$/.test(valor.trim()) ? Number(valor) : valor;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) {
    throw new ValidationError(`El campo ${campo} no es válido`);
  }
  return n;
}

/** Texto recortado con longitud entre min y max, o error 400. */
export function textoValido(valor: unknown, campo: string, min: number, max: number): string {
  const t = typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ') : '';
  if (t.length < min || t.length > max) {
    throw new ValidationError(`El campo ${campo} debe tener entre ${min} y ${max} caracteres`);
  }
  return t;
}

export function esCorreo(valor: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor) && valor.length <= 180;
}

export function esContrasenaSegura(valor: string): boolean {
  return valor.length >= 8 && /[A-ZÁÉÍÓÚÑ]/.test(valor) && /\d/.test(valor);
}
