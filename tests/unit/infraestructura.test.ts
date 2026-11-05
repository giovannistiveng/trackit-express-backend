import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import { OpenStreetAdapter, nombreCorto } from '../../src/infrastructure/external/open-street.adapter';
import { LocalDiskStorage } from '../../src/infrastructure/external/local-disk.storage';
import { CloudinaryStorage, cloudinaryConfigurado } from '../../src/infrastructure/external/cloudinary.adapter';
import { JWTService } from '../../src/infrastructure/security/jwt.service';
import { HashService } from '../../src/infrastructure/security/hash.service';
import { esViolacionUnica } from '../../src/infrastructure/database/pg-utils';
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
  const respuesta = (datos: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => datos }) as Response;
  const FUSA = { lat: '4.3369', lon: '-74.3638', display_name: 'Parque, Fusagasugá, Cundinamarca', name: 'Parque principal', address: { road: 'Carrera 6', town: 'Fusagasugá' } };
  const SILV = { lat: '4.4040', lon: '-74.3870', display_name: 'Silvania, Cundinamarca', address: { town: 'Silvania' } };
  const MEXICO = { lat: '19.43', lon: '-99.13', display_name: 'Calle 5, Ciudad de México' };

  /** fetch falso que responde según la URL. */
  function servidor(rutas: { nominatim?: (url: string) => unknown; osrm?: (url: string) => unknown }) {
    return jest.fn(async (url: string) => {
      if (url.includes('/route/v1/')) {
        const r = rutas.osrm?.(url);
        if (r instanceof Error) throw r;
        return respuesta(r ?? {}, r !== undefined);
      }
      const r = rutas.nominatim?.(url);
      if (r instanceof Error) throw r;
      return respuesta(r ?? [], r !== undefined);
    });
  }
  const crear = (f: ReturnType<typeof servidor>) => new OpenStreetAdapter('test@t.co', f as unknown as typeof fetch, 'https://osrm', 'https://nom', 0);

  it('busca dentro de la región, descarta resultados lejanos y arma un nombre corto', async () => {
    const f = servidor({ nominatim: (u) => (u.includes('bounded=1') ? [MEXICO, FUSA, FUSA] : []) });
    const geo = crear(f);
    const r = await geo.buscar('  parque   principal ');
    expect(r).toEqual([{ nombre: 'Parque principal, Carrera 6, Fusagasugá', detalle: FUSA.display_name, coords: { lat: 4.3369, lon: -74.3638 } }]);
    expect(f.mock.calls[0][0]).toContain('countrycodes=co');
    // Segunda vez sale de la caché
    await geo.buscar('Parque Principal');
    expect(f).toHaveBeenCalledTimes(1);
    expect(await geo.buscar('ab')).toEqual([]);
  });

  it('si no hay resultados en la región, reintenta en Cundinamarca', async () => {
    const f = servidor({ nominatim: (u) => (u.includes('Cundinamarca') ? [SILV] : []) });
    const r = await crear(f).buscar('Silvania');
    expect(r[0]).toMatchObject({ nombre: 'Silvania' });
    expect(f).toHaveBeenCalledTimes(2);
    const otra = servidor({ nominatim: () => [] });
    expect(await crear(otra).buscar('Vereda Cundinamarca')).toEqual([]);
    expect(otra).toHaveBeenCalledTimes(2);
  });

  it('dirección inversa', async () => {
    const f = servidor({ nominatim: () => FUSA });
    expect(await crear(f).inversa({ lat: 4.3, lon: -74.3 })).toMatchObject({ nombre: 'Parque principal, Carrera 6, Fusagasugá', coords: { lat: 4.3, lon: -74.3 } });
    expect(await crear(servidor({ nominatim: () => ({ error: 'Unable to geocode' }) })).inversa({ lat: 0, lon: 0 })).toBeNull();
  });

  it('usa la distancia por carretera de OSRM con las coordenadas conocidas', async () => {
    const f = servidor({ osrm: () => ({ code: 'Ok', routes: [{ distance: 11200, duration: 960 }] }) });
    const r = await crear(f).calcularDistancia('A', 'B', { origen: { lat: 4.3369, lon: -74.3638 }, destino: { lat: 4.404, lon: -74.387 } });
    expect(r).toMatchObject({ distancia_km: 11.2, duracion_segundos: 1200, exacta: true });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('https://osrm/route/v1/driving/-74.3638,4.3369;-74.387,4.404?overview=false&alternatives=false');
  });

  it('geocodifica el texto y, si OSRM falla, estima con línea recta × 1,35', async () => {
    const f = servidor({ nominatim: (u) => (/Silvania/.test(u) ? [SILV] : [FUSA]), osrm: () => new Error('caído') });
    const r = await crear(f).calcularDistancia('Parque', 'Silvania');
    expect(r.exacta).toBe(true);
    expect(r.distancia_km).toBeGreaterThan(10);
    expect(r.distancia_km).toBeLessThan(11.5);
    const sinRuta = servidor({ nominatim: (u) => (/Silvania/.test(u) ? [SILV] : [FUSA]), osrm: () => ({ code: 'NoRoute', routes: [] }) });
    expect((await crear(sinRuta).calcularDistancia('Parque', 'Silvania')).exacta).toBe(true);
  });

  it('usa una distancia estimada si no encuentra alguna dirección', async () => {
    const vacio = servidor({});
    expect(await crear(vacio).calcularDistancia('Casco Urbano', 'Silvania')).toMatchObject({ distancia_km: 16, exacta: false });
    const caido = jest.fn().mockRejectedValue(Object.assign(new Error('abort'), { name: 'AbortError' }));
    expect((await crear(caido as never).calcularDistancia('Pasca', 'Chinauta')).distancia_km).toBe(5);
    const raro = jest.fn().mockRejectedValue('texto');
    expect((await crear(raro as never).calcularDistancia('X', 'Y')).distancia_km).toBe(3);
  });

  it('nombreCorto usa display_name si no hay dirección', () => {
    expect(nombreCorto({ lat: '1', lon: '1', display_name: 'A, B, C, D' })).toBe('A, B, C');
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
