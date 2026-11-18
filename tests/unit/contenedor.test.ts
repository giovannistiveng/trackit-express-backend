import { describe, it, expect, jest, afterEach } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { Logger } from '../../src/shared/logger';

const ORIGINAL = { ...process.env };
const LOGS = path.join(os.tmpdir(), 'trackit-contenedor-logs');

afterEach(() => {
  process.env = { ...ORIGINAL };
  jest.resetModules();
});

type ModContenedor = typeof import('../../src/infrastructure/container');

/** Carga el contenedor con un entorno propio (sin leer el .env del equipo). */
function cargar(env: Record<string, string>): ModContenedor {
  process.env = { NODE_ENV: 'test', LOG_DIR: LOGS, VAPID_FILE: path.join(os.tmpdir(), `vapid-${Date.now()}.json`), ...env };
  let mod!: ModContenedor;
  jest.isolateModules(() => {
    jest.doMock('dotenv', () => ({ __esModule: true, default: { config: jest.fn() } }));
    mod = jest.requireActual<ModContenedor>('../../src/infrastructure/container');
  });
  return mod;
}

const log = new Logger({ dir: LOGS, level: 'ERROR', retentionDays: 0, toConsole: false });

describe('crearContenedor', () => {
  it('sin servicios configurados usa disco local, buzón de correos y Nequi simulado', () => {
    const { crearContenedor, horaActual } = cargar({});
    const c = crearContenedor({ pool: new Pool(), log });
    expect(c.storageLocal).toBe(true);
    expect(c.pasarela).toBe('Nequi (simulado)');
    // Sin claves en el entorno se generan las de web push
    expect(c.clavePush).toEqual(expect.any(String));
    expect(horaActual()).toBeInstanceOf(Date);
  });

  it('con credenciales usa Cloudinary, SMTP, Nequi Conecta y avisa si falta la cuenta de Firebase', () => {
    const { crearContenedor } = cargar({
      CLOUDINARY_CLOUD_NAME: 'nube-real',
      CLOUDINARY_API_KEY: '123456',
      CLOUDINARY_API_SECRET: 'secreto-real',
      SMTP_HOST: 'smtp.gmail.com',
      NEQUI_MODO: 'conecta',
      FCM_SERVICE_ACCOUNT_FILE: path.join(os.tmpdir(), 'no-existe-firebase.json'),
      VAPID_PUBLIC_KEY: 'publica',
      VAPID_PRIVATE_KEY: 'privada',
    });
    const c = crearContenedor({ pool: new Pool(), log });
    expect(c.storageLocal).toBe(false);
    expect(c.pasarela).toBe('Nequi Conecta');
    expect(c.clavePush).toBe('publica');
  });

  it('avisoDe registra el fallo como advertencia en su contexto', () => {
    const { avisoDe } = cargar({});
    const warn = jest.fn();
    const falso = { child: jest.fn(() => ({ warn })) } as unknown as Logger;
    avisoDe(falso, 'Push', 'No se pudo enviar')(new Error('x'));
    expect(falso.child).toHaveBeenCalledWith('Push');
    expect(warn).toHaveBeenCalledWith('No se pudo enviar', expect.any(Error));
  });
});
