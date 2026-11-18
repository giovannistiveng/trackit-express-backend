import { describe, it, expect, jest, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Logger, sanitize } from '../../src/shared/logger/logger';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'trackit-logs-'));
const fecha = new Date(2026, 9, 29, 14, 5, 9, 42);

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Logger: consola y metadatos', () => {
  it('manda cada nivel a su salida de consola', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const l = new Logger({ dir: tmpDir(), level: 'DEBUG', retentionDays: 0, toConsole: true, now: () => fecha });
    l.error('e');
    l.warn('w');
    l.info('i');
    await l.close();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[ERROR] e'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[WARN ] w'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[INFO ] i'));
  });

  it('serializa errores sin pila, objetos vacíos, ciclos y anidamiento profundo', async () => {
    const dir = tmpDir();
    const l = new Logger({ dir, level: 'DEBUG', retentionDays: 0, toConsole: false, now: () => fecha });
    l.info('con pila vacía', { stack: '', codigo: 7 });
    l.info('solo pila', { stack: 'traza' });
    const conBigInt = { a: 1n };
    l.info('no serializable', conBigInt);
    await l.close();
    const texto = fs.readFileSync(path.join(dir, 'trackit-2026-10-29.txt'), 'utf8');
    expect(texto).toContain('con pila vacía {"codigo":7}\n');
    expect(texto).toContain('solo pila\ntraza');
    expect(texto).toContain('no serializable [meta no serializable]');
    let profundo: unknown = 'fondo';
    for (let i = 0; i < 9; i++) profundo = { n: profundo };
    expect(JSON.stringify(sanitize(profundo))).toContain('"[...]"');
  });
});

describe('Logger: fallos de disco', () => {
  it('si no puede crear la carpeta desactiva el archivo y fatal() solo escribe en consola', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const archivo = path.join(tmpDir(), 'no-es-carpeta');
    fs.writeFileSync(archivo, 'x');
    const l = new Logger({ dir: path.join(archivo, 'sub'), level: 'DEBUG', retentionDays: 1, toConsole: false });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('No se pudo preparar la carpeta'), expect.anything());
    const append = jest.spyOn(fs, 'appendFileSync');
    l.fatal('sin disco');
    l.info('tampoco');
    expect(append).not.toHaveBeenCalled();
  });

  it('si abrir el archivo falla deja de intentarlo', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const l = new Logger({ dir: tmpDir(), level: 'DEBUG', retentionDays: 0, toConsole: false });
    jest.spyOn(fs, 'createWriteStream').mockImplementationOnce(() => {
      throw new Error('EMFILE');
    });
    l.info('uno');
    l.info('dos');
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Se desactiva la escritura'), expect.any(Error));
    await l.close();
  });

  it('un error del stream desactiva la escritura', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const dir = tmpDir();
    const l = new Logger({ dir, level: 'DEBUG', retentionDays: 0, toConsole: false, now: () => fecha });
    l.info('abre el archivo');
    const stream = (l as unknown as { mainStream: fs.WriteStream }).mainStream;
    stream.emit('error', new Error('disco lleno'));
    expect(error).toHaveBeenCalledWith('[logger] Error escribiendo el archivo de log:', 'disco lleno');
    await l.close();
  });
});
