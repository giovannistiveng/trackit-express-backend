import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import express from 'express';
import { Logger } from '../../src/shared/logger/logger';
import { requestLogger } from '../../src/infrastructure/http/middlewares/request-logger.middleware';

function listen(app: express.Express): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

describe('requestLogger', () => {
  it('debería registrar método, ruta, código e id, y ocultar la contraseña del cuerpo', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trackit-req-'));
    const fecha = new Date(2026, 9, 29, 10, 0, 0);
    const log = new Logger({ dir, level: 'DEBUG', retentionDays: 30, toConsole: false, now: () => fecha });

    const app = express();
    app.use(express.json());
    app.use(requestLogger(log));
    app.post('/api/auth/login', (_req, res) => {
      res.status(401).json({ error: 'Credenciales inválidas' });
    });
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok' });
    });

    const { server, url } = await listen(app);
    const r1 = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo: 'a@b.co', password: 'Secreta123' }),
    });
    await fetch(`${url}/health`);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await log.close();

    const id = r1.headers.get('x-request-id');
    const contenido = fs.readFileSync(path.join(dir, 'trackit-2026-10-29.txt'), 'utf8');
    const errores = fs.readFileSync(path.join(dir, 'errores-2026-10-29.txt'), 'utf8');

    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(contenido).toMatch(new RegExp(`\\[WARN \\] POST /api/auth/login → 401 \\(.+ ms\\) id=${id}`));
    expect(contenido).toMatch(/\[INFO \] GET \/health → 200/);
    expect(contenido).toContain('"password":"[OCULTO]"');
    expect(contenido).not.toContain('Secreta123');
    expect(errores).toContain('POST /api/auth/login → 401');
    expect(errores).not.toContain('/health');
  });
});
