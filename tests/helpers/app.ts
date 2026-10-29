import { readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { Pool } from 'pg';
import request from 'supertest';
import { pool } from '../../src/config/database';
import { config } from '../../src/config';
import { logger } from '../../src/shared/logger';
import { crearContenedor } from '../../src/infrastructure/container';
import { crearApp } from '../../src/infrastructure/http/app';
import { LocalDiskStorage } from '../../src/infrastructure/external/local-disk.storage';
import { DistancePort } from '../../src/domain/repositories/services.port';

export const DIR_UPLOADS = path.join(os.tmpdir(), 'trackit-test-uploads');

/** Distancia fija: las pruebas no dependen de OpenStreetMap. */
export const distanciaFija: DistancePort = {
  calcularDistancia: async () => ({ distancia_km: 34.5, duracion_segundos: 4140 }),
};

/** ¿Hay una base de datos de pruebas disponible? */
export async function hayBaseDeDatos(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** Borra y recrea el esquema de la base de pruebas. Se niega si el nombre no contiene "test". */
export async function reiniciarBase(p: Pool = pool): Promise<void> {
  const nombre = config.db.url ? new URL(config.db.url).pathname.slice(1) : config.db.database;
  if (!/test/i.test(nombre)) throw new Error(`Por seguridad, las pruebas solo borran bases cuyo nombre contiene "test" (actual: ${nombre})`);
  const dir = path.resolve(__dirname, '..', '..', 'database');
  await p.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await p.query(readFileSync(path.join(dir, 'schema.sql'), 'utf8'));
  await p.query(readFileSync(path.join(dir, 'seed.sql'), 'utf8'));
}

export function crearAppPrueba() {
  const contenedor = crearContenedor({
    pool,
    log: logger,
    distancia: distanciaFija,
    storage: new LocalDiskStorage(DIR_UPLOADS, 'http://localhost:3000'),
  });
  return crearApp({ contenedor, log: logger, salud: async () => (await pool.query('SELECT 1'), true) });
}

export type Agente = ReturnType<typeof request>;

/** Registra (si hace falta) e inicia sesión; devuelve el token y el id del usuario. */
export async function sesion(app: Parameters<typeof request>[0], correo: string, rol: 2 | 3, nombre = 'Usuario Prueba') {
  await request(app).post('/api/auth/register').send({ nombre, correo, password: 'Clave1234', id_rol: rol });
  const r = await request(app).post('/api/auth/login').send({ correo, password: 'Clave1234' });
  return { token: r.body.token as string, id: r.body.user.id as number };
}

export async function sesionAdmin(app: Parameters<typeof request>[0]) {
  const r = await request(app).post('/api/auth/login').send({ correo: 'admin@trackit.com.co', password: 'Admin2026*' });
  return { token: r.body.token as string, id: r.body.user.id as number };
}
