import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import { AddressInfo } from 'node:net';
import { pool } from '../../src/config/database';
import { crearApp } from '../../src/infrastructure/http/app';
import { logger } from '../../src/shared/logger';
import { FUSA, crearAppPrueba, crearContenedorPrueba, hayBaseDeDatos, reiniciarBase, sesion } from '../helpers/app';

let disponible = false;
const app = crearAppPrueba();

beforeAll(async () => {
  disponible = await hayBaseDeDatos();
  if (disponible) await reiniciarBase();
});

afterAll(async () => {
  await pool.end();
});

const conBd = (nombre: string, fn: () => Promise<void>) =>
  it(nombre, async () => {
    if (!disponible) return expect(disponible).toBe(false);
    await fn();
  });

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('HTTP: casos de borde', () => {
  it('/health responde 503 cuando la comprobación de la base falla', async () => {
    const caida = crearApp({ contenedor: crearContenedorPrueba(), log: logger, salud: () => Promise.reject(new Error('sin conexión')) });
    const r = await request(caida).get('/health');
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ status: 'degradado', baseDatos: 'sin conexión' });
  });

  conBd('buscar direcciones y la dirección de un punto', async () => {
    const s = await sesion(app, 'geo.cli@t.co', 2);
    const buscar = await request(app).get('/api/geo/buscar').query({ q: 'Silvania' }).set(auth(s.token));
    expect(buscar.body.resultados[0]).toMatchObject({ nombre: 'Silvania' });
    const inversa = await request(app).get('/api/geo/inversa').query({ lat: FUSA.lat, lon: FUSA.lon }).set(auth(s.token));
    expect(inversa.body.resultado).toMatchObject({ nombre: 'Parque principal, Fusagasugá' });
  });

  conBd('el canal de eventos envía un latido cada 25 s para que el proxy no lo cierre', async () => {
    const s = await sesion(app, 'latido.cli@t.co', 2);
    const servidor = app.listen(0);
    const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    const ctrl = new AbortController();
    try {
      const ticket = (await request(app).post('/api/eventos/ticket').set(auth(s.token))).body.ticket as string;
      // Solo se simula el intervalo; la red y los demás temporizadores siguen siendo reales
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'Date', 'hrtime', 'performance'] });
      const r = await fetch(`${base}/api/eventos?ticket=${ticket}`, { signal: ctrl.signal });
      const lector = r.body!.getReader();
      let texto = '';
      while (!texto.includes('event: conectado')) texto += new TextDecoder().decode((await lector.read()).value);
      jest.advanceTimersByTime(25_000);
      while (!texto.includes(': latido')) texto += new TextDecoder().decode((await lector.read()).value);
      expect(texto).toContain(': latido');
    } finally {
      jest.useRealTimers();
      ctrl.abort();
      servidor.close();
    }
  });
});
