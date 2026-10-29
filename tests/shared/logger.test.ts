import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Logger, sanitize } from '../../src/shared/logger/logger';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'trackit-logs-'));
}

function read(dir: string, file: string): string {
  const p = path.join(dir, file);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

describe('Logger', () => {
  const fecha = new Date(2026, 9, 29, 14, 5, 9, 42); // 29/10/2026 14:05:09.042 local

  it('debería escribir en trackit-AAAA-MM-DD.txt con fecha, nivel y contexto', async () => {
    const dir = tmpDir();
    const log = new Logger({ dir, level: 'DEBUG', retentionDays: 30, toConsole: false, now: () => fecha });
    log.child('Pruebas').info('Hola mundo');
    await log.close();

    expect(read(dir, 'trackit-2026-10-29.txt')).toBe('[2026-10-29 14:05:09.042] [INFO ] [Pruebas] Hola mundo\n');
  });

  it('debería copiar WARN y ERROR a errores-AAAA-MM-DD.txt, pero no INFO', async () => {
    const dir = tmpDir();
    const log = new Logger({ dir, level: 'DEBUG', retentionDays: 30, toConsole: false, now: () => fecha });
    log.info('informativo');
    log.warn('advertencia');
    log.error('falla', new Error('boom'));
    await log.close();

    const errores = read(dir, 'errores-2026-10-29.txt');
    expect(errores).not.toContain('informativo');
    expect(errores).toContain('[WARN ] advertencia');
    expect(errores).toContain('[ERROR] falla {"name":"Error","message":"boom"}');
    expect(errores).toContain('at '); // incluye el stack
  });

  it('debería respetar el nivel mínimo configurado', async () => {
    const dir = tmpDir();
    const log = new Logger({ dir, level: 'WARN', retentionDays: 30, toConsole: false, now: () => fecha });
    log.debug('d');
    log.info('i');
    log.warn('w');
    await log.close();

    const contenido = read(dir, 'trackit-2026-10-29.txt');
    expect(contenido).not.toContain('] d');
    expect(contenido).not.toContain('] i');
    expect(contenido).toContain('] w');
  });

  it('debería rotar al cambiar el día', async () => {
    const dir = tmpDir();
    let ahora = new Date(2026, 9, 29, 23, 59, 59);
    const log = new Logger({ dir, level: 'INFO', retentionDays: 30, toConsole: false, now: () => ahora });
    log.info('antes de medianoche');
    ahora = new Date(2026, 9, 30, 0, 0, 1);
    log.info('después de medianoche');
    await log.close();

    expect(read(dir, 'trackit-2026-10-29.txt')).toContain('antes de medianoche');
    expect(read(dir, 'trackit-2026-10-30.txt')).toContain('después de medianoche');
  });

  it('debería borrar al arrancar los archivos más antiguos que la retención', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'trackit-2026-09-01.txt'), 'viejo');
    fs.writeFileSync(path.join(dir, 'errores-2026-09-01.txt'), 'viejo');
    fs.writeFileSync(path.join(dir, 'trackit-2026-10-25.txt'), 'reciente');
    fs.writeFileSync(path.join(dir, 'notas.txt'), 'no es un log');

    new Logger({ dir, level: 'INFO', retentionDays: 30, toConsole: false, now: () => fecha });

    expect(fs.readdirSync(dir).sort()).toEqual(['notas.txt', 'trackit-2026-10-25.txt']);
  });

  it('debería escribir de forma síncrona con fatal()', () => {
    const dir = tmpDir();
    const log = new Logger({ dir, level: 'INFO', retentionDays: 30, toConsole: false, now: () => fecha });
    log.fatal('se cae');

    expect(read(dir, 'trackit-2026-10-29.txt')).toContain('[ERROR] se cae');
    expect(read(dir, 'errores-2026-10-29.txt')).toContain('[ERROR] se cae');
  });

  it('debería ocultar contraseñas, PIN y tokens en el archivo', async () => {
    const dir = tmpDir();
    const log = new Logger({ dir, level: 'DEBUG', retentionDays: 30, toConsole: false, now: () => fecha });
    log.debug('cuerpo', { correo: 'a@b.co', password: 'Secreta123', pin_seguridad: '1234' });
    await log.close();

    const contenido = read(dir, 'trackit-2026-10-29.txt');
    expect(contenido).not.toContain('Secreta123');
    expect(contenido).not.toContain('1234');
    expect(contenido).toContain('a@b.co');
  });
});

describe('sanitize', () => {
  it('debería ocultar campos sensibles anidados y en arreglos', () => {
    const entrada = {
      user: { nombre: 'Ana', password: 'x' },
      token: 'jwt',
      headers: { Authorization: 'Bearer abc' },
      lista: [{ pin: '0000', estado: 'Pendiente' }],
    };
    expect(sanitize(entrada)).toEqual({
      user: { nombre: 'Ana', password: '[OCULTO]' },
      token: '[OCULTO]',
      headers: { Authorization: '[OCULTO]' },
      lista: [{ pin: '[OCULTO]', estado: 'Pendiente' }],
    });
  });

  it('no debería ocultar campos que solo contienen "pin" dentro de otra palabra', () => {
    expect(sanitize({ shipping: 'si', opinion: 'buena' })).toEqual({ shipping: 'si', opinion: 'buena' });
  });

  it('debería resumir buffers sin volcar su contenido', () => {
    expect(sanitize({ archivo: Buffer.alloc(10) })).toEqual({ archivo: '[Buffer 10 bytes]' });
  });

  it('no debería modificar el objeto original', () => {
    const original = { password: 'x' };
    sanitize(original);
    expect(original.password).toBe('x');
  });
});
