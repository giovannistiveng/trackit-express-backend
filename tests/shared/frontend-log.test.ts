import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import express from 'express';
import { Logger } from '../../src/shared/logger/logger';
import { FrontendLogController, normalizarEvento } from '../../src/infrastructure/http/controllers/frontend-log.controller';
import { createFrontendLogRoutes } from '../../src/infrastructure/http/routes/frontend-log.routes';
import { rateLimit } from '../../src/infrastructure/http/middlewares/rate-limit.middleware';

function listen(app: express.Express): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('normalizarEvento', () => {
  it('debería aceptar un evento válido y normalizar el nivel', () => {
    expect(normalizarEvento({ nivel: 'error', mensaje: 'falla' })).toMatchObject({ nivel: 'ERROR', mensaje: 'falla' });
  });

  it('debería descartar nivel inválido o mensaje vacío', () => {
    expect(normalizarEvento({ nivel: 'FATAL', mensaje: 'x' })).toBeNull();
    expect(normalizarEvento({ nivel: 'INFO', mensaje: '   ' })).toBeNull();
    expect(normalizarEvento('texto')).toBeNull();
  });

  it('debería quitar saltos de línea para que no se puedan falsificar líneas del log', () => {
    const ev = normalizarEvento({ nivel: 'INFO', mensaje: 'a\n[2026-01-01] [ERROR] falso' });
    expect(ev?.mensaje).toBe('a [2026-01-01] [ERROR] falso');
  });

  it('debería recortar mensajes largos y reemplazar meta demasiado grande', () => {
    const ev = normalizarEvento({ nivel: 'INFO', mensaje: 'x'.repeat(5000), meta: { d: 'y'.repeat(5000) } });
    expect(ev?.mensaje.length).toBe(2000);
    expect(ev?.meta).toBe('[meta demasiado grande]');
  });
});

describe('POST /api/logs/frontend', () => {
  it('debería escribir los eventos válidos en frontend-AAAA-MM-DD.txt y ocultar datos sensibles', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trackit-front-'));
    const fecha = new Date(2026, 9, 29, 9, 30, 0);
    const log = new Logger({
      dir, level: 'DEBUG', retentionDays: 30, toConsole: false, now: () => fecha,
      filePrefix: 'frontend', errorFilePrefix: null,
    });
    const app = express();
    app.use(express.json());
    app.use('/api/logs', createFrontendLogRoutes(new FrontendLogController(log)));
    const { server, url } = await listen(app);

    const r = await post(`${url}/api/logs/frontend`, {
      eventos: [
        { nivel: 'ERROR', mensaje: 'Fallo al cotizar', contexto: 'Cotizacion', url: '/cliente/nuevo-envio', meta: { status: 500, token: 'abc' } },
        { nivel: 'INFO', mensaje: 'Inicio de sesión', usuario: 7 },
        { nivel: 'NADA', mensaje: 'inválido' },
      ],
    });
    const vacio = await post(`${url}/api/logs/frontend`, { eventos: [] });
    await new Promise<void>((res) => server.close(() => res()));
    await log.close();

    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ recibidos: 2, descartados: 1 });
    expect(vacio.status).toBe(400);

    const contenido = fs.readFileSync(path.join(dir, 'frontend-2026-10-29.txt'), 'utf8');
    expect(contenido).toContain('[ERROR] [Cotizacion] Fallo al cotizar');
    expect(contenido).toContain('"url":"/cliente/nuevo-envio"');
    expect(contenido).toContain('"token":"[OCULTO]"');
    expect(contenido).toContain('[INFO ] [App] Inicio de sesión');
    expect(contenido).not.toContain('inválido');
    expect(fs.readdirSync(dir)).toEqual(['frontend-2026-10-29.txt']);
  });

  it('debería rechazar lotes de más de 50 eventos', async () => {
    const log = new Logger({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tf-')), level: 'DEBUG', retentionDays: 0, toConsole: false });
    const app = express();
    app.use(express.json());
    app.use('/api/logs', createFrontendLogRoutes(new FrontendLogController(log)));
    const { server, url } = await listen(app);
    const r = await post(`${url}/api/logs/frontend`, { eventos: Array(51).fill({ nivel: 'INFO', mensaje: 'x' }) });
    await new Promise<void>((res) => server.close(() => res()));
    await log.close();
    expect(r.status).toBe(400);
  });
});

describe('rateLimit', () => {
  it('debería responder 429 al superar el máximo y reiniciar al pasar la ventana', async () => {
    let ahora = 0;
    const app = express();
    app.use(rateLimit(2, 1000, () => ahora));
    app.get('/', (_req, res) => { res.send('ok'); });
    const { server, url } = await listen(app);

    const s1 = (await fetch(url)).status;
    const s2 = (await fetch(url)).status;
    const s3 = await fetch(url);
    ahora = 1500;
    const s4 = (await fetch(url)).status;
    await new Promise<void>((res) => server.close(() => res()));

    expect([s1, s2, s3.status, s4]).toEqual([200, 200, 429, 200]);
    expect(s3.headers.get('retry-after')).toBe('1');
  });
});
