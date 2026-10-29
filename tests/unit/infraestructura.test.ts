import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import { OpenStreetAdapter } from '../../src/infrastructure/external/open-street.adapter';
import { LocalDiskStorage } from '../../src/infrastructure/external/local-disk.storage';
import { CloudinaryStorage, cloudinaryConfigurado } from '../../src/infrastructure/external/cloudinary.adapter';
import { JWTService } from '../../src/infrastructure/security/jwt.service';
import { HashService } from '../../src/infrastructure/security/hash.service';
import { esViolacionUnica } from '../../src/infrastructure/database/pg-errors';
import { manejarErrores } from '../../src/infrastructure/http/middlewares/error.middleware';
import { actorDe, autenticar, autorizar } from '../../src/infrastructure/http/middlewares/auth.middleware';
import { Logger } from '../../src/shared/logger';
import { AppError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../../src/shared/errors';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn((_opciones: unknown, cb: (e: unknown, r?: { secure_url: string }) => void) => ({
        end: (buffer: Buffer) => (buffer.length > 0 ? cb(null, { secure_url: 'https://res.cloudinary.com/x.jpg' }) : cb(new Error('vacío'))),
      })),
    },
  },
}));

const logMudo = new Logger({ dir: os.tmpdir(), level: 'ERROR', retentionDays: 0, toConsole: false });

describe('OpenStreetAdapter', () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  const respuesta = (datos: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => datos }) as Response;

  it('usa Haversine cuando geocodifica origen y destino', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(respuesta([{ lat: '4.3369', lon: '-74.3638' }]))
      .mockResolvedValueOnce(respuesta([{ lat: '4.4040', lon: '-74.3870' }])) as unknown as typeof fetch;
    const r = await new OpenStreetAdapter().calcularDistancia('Fusagasugá', 'Silvania');
    expect(r.distancia_km).toBeGreaterThan(7);
    expect(r.distancia_km).toBeLessThan(9);
    expect(r.duracion_segundos).toBeGreaterThan(0);
  });

  it('usa distancia simulada si Nominatim no encuentra, falla o responde error', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(respuesta([]))
      .mockResolvedValueOnce(respuesta({}, false)) as unknown as typeof fetch;
    expect((await new OpenStreetAdapter().calcularDistancia('Casco Urbano', 'Silvania')).distancia_km).toBe(34.5);
    global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error('abort'), { name: 'AbortError' })) as unknown as typeof fetch;
    expect((await new OpenStreetAdapter().calcularDistancia('Pasca', 'Bogotá')).distancia_km).toBe(12);
    global.fetch = jest.fn().mockRejectedValue('texto') as unknown as typeof fetch;
    expect((await new OpenStreetAdapter().calcularDistancia('X', 'Y')).distancia_km).toBe(2);
  });
});

describe('almacenamiento', () => {
  it('LocalDiskStorage guarda en disco y devuelve la URL pública', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'up-'));
    const url = await new LocalDiskStorage(dir, 'https://api.x').upload({ buffer: Buffer.from('hola'), mimetype: 'application/pdf', originalname: 'a.pdf' }, 'trackit/doc s/1');
    expect(url).toMatch(/^https:\/\/api\.x\/uploads\/trackit\/docs\/1\/\d+-[0-9a-f]{8}\.pdf$/);
    const archivo = path.join(dir, url.replace('https://api.x/uploads/', ''));
    expect(await fs.readFile(archivo, 'utf8')).toBe('hola');
    const sinExt = await new LocalDiskStorage(dir, 'https://api.x').upload({ buffer: Buffer.from('x'), mimetype: 'image/webp', originalname: 'a' }, '/raiz');
    expect(sinExt).toMatch(/\/uploads\/raiz\/\d+-[0-9a-f]{8}$/);
  });

  it('CloudinaryStorage sube imágenes y PDF, y propaga errores', async () => {
    const s = new CloudinaryStorage({ cloudName: 'c', apiKey: 'k', apiSecret: 's' });
    expect(await s.upload({ buffer: Buffer.from('x'), mimetype: 'application/pdf', originalname: 'a.pdf' }, 'f')).toBe('https://res.cloudinary.com/x.jpg');
    await expect(s.upload({ buffer: Buffer.alloc(0), mimetype: 'image/jpeg', originalname: 'a.jpg' }, 'f')).rejects.toThrow('vacío');
  });

  it('cloudinaryConfigurado descarta los valores de ejemplo', () => {
    expect(cloudinaryConfigurado({ cloudName: 'demo', apiKey: '123', apiSecret: 'abc' })).toBe(true);
    expect(cloudinaryConfigurado({ cloudName: 'tu_cloudinary_cloud_name', apiKey: '1', apiSecret: '2' })).toBe(false);
    expect(cloudinaryConfigurado({ cloudName: '', apiKey: '1', apiSecret: '2' })).toBe(false);
  });
});

describe('seguridad', () => {
  it('JWTService firma, verifica y rechaza tokens ajenos o con forma inválida', () => {
    const jwt = new JWTService('secreto-1-con-longitud-suficiente-32', '1h');
    const t = jwt.sign({ userId: 4, email: 'a@b.co', role: '2' });
    expect(jwt.verify(t)).toEqual({ userId: 4, email: 'a@b.co', role: '2' });
    expect(new JWTService('otro-secreto-con-longitud-suficiente', '1h').verify(t)).toBeNull();
    const raro = new JWTService('secreto-1-con-longitud-suficiente-32', '1h').sign({ userId: 'x', role: 2 } as never);
    expect(jwt.verify(raro)).toBeNull();
  });

  it('HashService compara con bcrypt', async () => {
    const h = new HashService();
    const hash = await h.hash('Clave1234');
    expect(await h.compare('Clave1234', hash)).toBe(true);
    expect(await h.compare('otra', hash)).toBe(false);
  });

  it('middlewares de autenticación y roles', async () => {
    const jwt = new JWTService('secreto-1-con-longitud-suficiente-32', '1h');
    const app = express();
    app.get('/a', autenticar(jwt), autorizar(1), (req, res) => {
      res.json(actorDe(req));
    });
    app.get('/b', autorizar(1), (_req, res) => {
      res.send('x');
    });
    app.get('/c', (req, res) => {
      res.json(actorDe(req));
    });
    app.use(manejarErrores(logMudo));
    expect((await request(app).get('/a').set('Authorization', 'Token x')).status).toBe(401);
    expect((await request(app).get('/b')).status).toBe(401);
    expect((await request(app).get('/c')).status).toBe(401);
    expect((await request(app).get('/a').set('Authorization', `Bearer ${jwt.sign({ userId: 1, email: '', role: '2' })}`)).status).toBe(403);
    const ok = await request(app).get('/a').set('Authorization', `Bearer ${jwt.sign({ userId: 1, email: 'a@b.co', role: '1' })}`);
    expect(ok.body).toEqual({ userId: 1, role: 1, email: 'a@b.co' });
  });
});

describe('manejarErrores', () => {
  function app(error: unknown) {
    const a = express();
    a.get('/', () => {
      throw error;
    });
    a.use(manejarErrores(logMudo));
    return a;
  }

  it.each([
    [new ValidationError('x'), 400],
    [new NotFoundError(), 404],
    [new UnauthorizedError(), 401],
    [new ForbiddenError(), 403],
    [new AppError('boom'), 500],
    [new multer.MulterError('LIMIT_FILE_COUNT'), 400],
    [new multer.MulterError('LIMIT_FIELD_KEY'), 400],
    [Object.assign(new Error('grande'), { type: 'entity.too.large' }), 413],
    [new Error('inesperado'), 500],
    ['texto', 500],
  ])('convierte %p en %i con { error, statusCode }', async (error, status) => {
    const r = await request(app(error)).get('/');
    expect(r.status).toBe(status);
    expect(r.body).toEqual({ error: expect.any(String), statusCode: status });
  });

  it('nunca expone el detalle de un error 500', async () => {
    const r = await request(app(new Error('contraseña de la BD'))).get('/');
    expect(r.body.error).toBe('Error interno del servidor');
  });

  it('esViolacionUnica reconoce el código 23505', () => {
    expect(esViolacionUnica({ code: '23505' })).toBe(true);
    expect(esViolacionUnica(null)).toBe(false);
    expect(esViolacionUnica('x')).toBe(false);
  });
});
