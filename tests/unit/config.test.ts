import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';

/**
 * La configuración se lee una sola vez al importar el módulo: cada prueba carga una copia aislada
 * con su propio entorno y sin leer el .env del equipo.
 */
const ORIGINAL = { ...process.env };

function cargar<T>(modulo: string, env: Record<string, string | undefined>): T {
  process.env = { ...env };
  let resultado!: T;
  jest.isolateModules(() => {
    jest.doMock('dotenv', () => ({ __esModule: true, default: { config: jest.fn() } }));
    resultado = jest.requireActual<T>(modulo);
  });
  return resultado;
}

beforeEach(() => {
  jest.resetModules();
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  jest.dontMock('dotenv');
  jest.dontMock('pg');
});

describe('config', () => {
  it('sin variables usa los valores por defecto de desarrollo', () => {
    const { config } = cargar<typeof import('../../src/config')>('../../src/config', {});
    expect(config).toMatchObject({
      port: 3000,
      nodeEnv: 'development',
      db: { url: '', ssl: false, host: 'localhost', port: 5432, user: 'postgres', database: 'trackit_express' },
      jwt: { expiresIn: '24h' },
      bcrypt: { saltRounds: 10 },
      publicUrl: 'http://localhost:3000',
      cloudinary: { cloudName: '', apiKey: '', apiSecret: '' },
      log: { dir: 'logs', level: '', retentionDays: 30, toConsole: true },
      geoModo: 'osm',
    });
    expect(config.db.password).toBe('postgres');
    expect(config.jwt.secret).toBe('default_secret_change_in_production');
  });

  it('con variables las respeta y quita la barra final de las URL', () => {
    const { config } = cargar<typeof import('../../src/config')>('../../src/config', {
      PORT: '8080',
      NODE_ENV: 'production',
      DB_SSL: 'TRUE',
      DB_HOST: 'db',
      DB_PORT: '6543',
      DB_USER: 'app',
      DB_PASSWORD: 'clave-de-prueba',
      DB_NAME: 'trackit',
      JWT_SECRET: 'secreto-largo-de-pruebas-para-configuracion',
      JWT_EXPIRES_IN: '2h',
      BCRYPT_SALT_ROUNDS: '12',
      PUBLIC_URL: 'https://api.trackit.co/',
      CLOUDINARY_CLOUD_NAME: 'nube',
      CLOUDINARY_API_KEY: 'k',
      CLOUDINARY_API_SECRET: 's',
      LOG_DIR: '/var/log/trackit',
      LOG_LEVEL: 'warn',
      LOG_TO_CONSOLE: 'False',
      GEO_MODO: 'Sin-Red',
    });
    expect(config).toMatchObject({
      port: 8080,
      nodeEnv: 'production',
      db: { ssl: true, host: 'db', port: 6543, user: 'app', database: 'trackit' },
      jwt: { expiresIn: '2h' },
      bcrypt: { saltRounds: 12 },
      publicUrl: 'https://api.trackit.co',
      cloudinary: { cloudName: 'nube', apiKey: 'k', apiSecret: 's' },
      log: { dir: '/var/log/trackit', level: 'WARN', toConsole: false },
      geoModo: 'sin-red',
    });
  });
});

describe('logger de la aplicación', () => {
  type ModLogger = typeof import('../../src/shared/logger');
  const dir = { LOG_DIR: path.join(os.tmpdir(), 'trackit-config-logs') };

  it('nivel inválido: DEBUG en desarrollo e INFO en producción; consola fuera de pruebas', () => {
    const dev = cargar<ModLogger>('../../src/shared/logger', { ...dir, LOG_LEVEL: 'mucho' });
    expect((dev.logger as unknown as { opts: { level: string; toConsole: boolean } }).opts).toMatchObject({
      level: 'DEBUG',
      toConsole: true,
    });
    const prod = cargar<ModLogger>('../../src/shared/logger', { ...dir, NODE_ENV: 'production' });
    expect((prod.logger as unknown as { opts: { level: string } }).opts.level).toBe('INFO');
    const ok = cargar<ModLogger>('../../src/shared/logger', { ...dir, NODE_ENV: 'test', LOG_LEVEL: 'error' });
    expect((ok.logger as unknown as { opts: { level: string; toConsole: boolean } }).opts).toMatchObject({
      level: 'ERROR',
      toConsole: false,
    });
    // El índice reexporta las utilidades del logger
    expect(ok.sanitize({ password: 'x' })).toEqual({ password: '[OCULTO]' });
    expect(ok.formatDate(new Date(2026, 0, 2))).toBe('2026-01-02');
    expect(ok.formatTimestamp(new Date(2026, 0, 2, 3, 4, 5, 6))).toBe('2026-01-02 03:04:05.006');
    expect(new ok.Logger({ dir: dir.LOG_DIR, level: 'INFO', retentionDays: 0, toConsole: false })).toBeInstanceOf(
      ok.Logger,
    );
  });
});

describe('pool de PostgreSQL', () => {
  type ModDb = typeof import('../../src/config/database');

  /** Pool falso que guarda las opciones y los manejadores registrados. */
  function poolFalso(conectar: () => Promise<unknown>) {
    const creados: { opciones: Record<string, unknown>; on: Record<string, (x: unknown) => void> }[] = [];
    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation((opciones) => {
        const p = { opciones: opciones as Record<string, unknown>, on: {} as Record<string, (x: unknown) => void> };
        creados.push(p);
        return {
          on: (ev: string, fn: (x: unknown) => void) => (p.on[ev] = fn),
          connect: conectar,
        };
      }),
    }));
    return creados;
  }

  const env = { LOG_DIR: path.join(os.tmpdir(), 'trackit-config-logs'), NODE_ENV: 'test' };

  it('con DATABASE_URL usa la cadena, SSL y fija la zona horaria al conectar', async () => {
    const release = jest.fn();
    const creados = poolFalso(async () => ({ release }));
    const db = cargar<ModDb>('../../src/config/database', {
      ...env,
      DATABASE_URL: 'postgres://u@h/db',
      DB_SSL: 'true',
    });
    expect(creados[0].opciones).toMatchObject({
      connectionString: 'postgres://u@h/db',
      ssl: { rejectUnauthorized: false },
    });
    const query = jest.fn(async () => {
      throw new Error('pooler sin SET');
    });
    creados[0].on.connect({ query });
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/^SET TIME ZONE '/));
    creados[0].on.error(new Error('reinicio'));
    await db.testConnection();
    expect(release).toHaveBeenCalled();
    await new Promise((r) => setImmediate(r));
  });

  it('sin URL usa los campos sueltos y testConnection propaga el error', async () => {
    const creados = poolFalso(async () => {
      throw new Error('sin servidor');
    });
    const db = cargar<ModDb>('../../src/config/database', { ...env, DB_HOST: 'pg' });
    expect(creados[0].opciones).toMatchObject({ host: 'pg', options: expect.stringContaining('-c timezone=') });
    expect(creados[0].opciones).not.toHaveProperty('ssl');
    expect(creados[0].on.connect).toBeUndefined();
    await expect(db.testConnection()).rejects.toThrow('sin servidor');
  });

  it('si Node no informa zona horaria usa UTC', async () => {
    poolFalso(async () => ({ release: jest.fn() }));
    const real = Intl.DateTimeFormat;
    jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () => ({ resolvedOptions: () => ({ timeZone: '' }) }) as unknown as Intl.DateTimeFormat,
    );
    const db = cargar<ModDb>('../../src/config/database', env);
    expect(db.ZONA_HORARIA).toBe('UTC');
    await db.testConnection();
    (Intl as { DateTimeFormat: typeof real }).DateTimeFormat = real;
  });
});
