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

/** Texto opcional: null si viene vacío; si no, recortado y con longitud máxima. */
export function textoOpcional(valor: unknown, campo: string, max: number): string | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new ValidationError(`El campo ${campo} debe ser texto`);
  const t = valor.trim().replace(/\s+/g, ' ');
  if (t.length === 0) return null;
  if (t.length > max) throw new ValidationError(`El campo ${campo} admite máximo ${max} caracteres`);
  return t;
}

/** Teléfono colombiano: 7 a 15 dígitos, admite + inicial, espacios y guiones. */
export function telefonoOpcional(valor: unknown): string | null {
  const t = textoOpcional(valor, 'telefono', 20);
  if (t === null) return null;
  const limpio = t.replace(/[\s-]/g, '');
  if (!/^\+?\d{7,15}$/.test(limpio)) throw new ValidationError('El teléfono debe tener entre 7 y 15 dígitos');
  return limpio;
}

export function esCorreo(valor: string): boolean {
  if (valor.length > 180 || /\s/.test(valor)) return false;
  const arroba = valor.indexOf('@');
  if (arroba < 1 || arroba !== valor.lastIndexOf('@')) return false;
  const dominio = valor.slice(arroba + 1);
  const punto = dominio.lastIndexOf('.');
  return punto > 0 && dominio.length - punto - 1 >= 2;
}

export function esContrasenaSegura(valor: string): boolean {
  return valor.length >= 8 && /[A-ZÁÉÍÓÚÑ]/.test(valor) && /\d/.test(valor);
}

/** Número dentro de un rango; lanza 400 con el nombre del campo. */
export function numeroEnRango(valor: unknown, campo: string, min: number, max: number): number {
  const n = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
    throw new ValidationError(`El campo "${campo}" debe ser un número entre ${min} y ${max}`);
  }
  return n;
}

/** Coordenadas opcionales { lat, lon }; null si no vienen. */
export function coordenadasOpcionales(valor: unknown, campo: string): { lat: number; lon: number } | null {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor !== 'object') throw new ValidationError(`El campo "${campo}" debe tener lat y lon`);
  const v = valor as { lat?: unknown; lon?: unknown };
  return { lat: numeroEnRango(v.lat, `${campo}.lat`, -90, 90), lon: numeroEnRango(v.lon, `${campo}.lon`, -180, 180) };
}
