import { describe, it, expect, jest, afterEach } from '@jest/globals';
import express, { Request, Response as Respuesta } from 'express';
import request from 'supertest';
import { v2 as cloudinary } from 'cloudinary';
import webpush from 'web-push';
import { CloudinaryStorage } from '../../src/infrastructure/external/cloudinary.adapter';
import { SmtpMailer, ocultarCorreo } from '../../src/infrastructure/external/mailers';
import { NequiConectaGateway, NequiSimuladoGateway } from '../../src/infrastructure/external/nequi.gateways';
import { CacheTemporal, OpenStreetAdapter } from '../../src/infrastructure/external/open-street.adapter';
import { FcmSender, WebPushSender } from '../../src/infrastructure/realtime/push.senders';
import { EventBusMemoria } from '../../src/infrastructure/realtime/event-bus';
import { JWTService } from '../../src/infrastructure/security/jwt.service';
import { rateLimit } from '../../src/infrastructure/http/middlewares/rate-limit.middleware';
import { requestLogger } from '../../src/infrastructure/http/middlewares/request-logger.middleware';
import { normalizarEvento } from '../../src/infrastructure/http/frontend-log.controller';
import { origenPermitido } from '../../src/infrastructure/http/app';
import { iniciarTareas } from '../../src/infrastructure/jobs';
import { Migrador } from '../../src/infrastructure/database/migrador';
import { Contenedor } from '../../src/infrastructure/container';
import { logger } from '../../src/shared/logger';

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function urlDe(u: string | URL | globalThis.Request): string {
  if (typeof u === 'string') return u;
  return u instanceof URL ? u.href : u.url;
}
const respuesta = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;
const JPG = { buffer: Buffer.from([1]), mimetype: 'image/jpeg', originalname: 'f.jpg', size: 1 };

describe('Cloudinary', () => {
  function subidaQueResponde(error: unknown, result: unknown) {
    jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation(((_o: unknown, cb: (e: unknown, r: unknown) => void) => {
      cb(error, result);
      return { end: jest.fn() };
    }) as never);
  }
  const storage = () => new CloudinaryStorage({ cloudName: 'n', apiKey: 'k', apiSecret: 's' });

  it('devuelve la URL segura o rechaza siempre con un Error', async () => {
    subidaQueResponde(undefined, { secure_url: 'https://res/f.jpg' });
    await expect(storage().upload(JPG, 'c')).resolves.toBe('https://res/f.jpg');
    subidaQueResponde({ message: 'Archivo inválido', http_code: 400 }, undefined);
    await expect(storage().upload(JPG, 'c')).rejects.toThrow(new Error('Archivo inválido'));
    subidaQueResponde(undefined, undefined);
    await expect(storage().upload(JPG, 'c')).rejects.toThrow('Error subiendo archivo a Cloudinary');
  });
});

describe('correo, Nequi y push con sus dependencias reales por defecto', () => {
  it('SMTP con usuario crea su transporte; ocultar un correo sin arroba', () => {
    expect(new SmtpMailer({ host: 'h', port: 587, secure: false, user: 'u', pass: 'p', remitente: 'x' })).toBeInstanceOf(SmtpMailer);
    expect(ocultarCorreo('sinarroba')).toBe('si***@');
  });

  it('Nequi Conecta usa fetch global, un ClientID por defecto y una respuesta sin cuerpo', async () => {
    const fetchGlobal = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      urlDe(url).startsWith('https://auth')
        ? respuesta(200, { access_token: 't', expires_in: 3600 })
        : respuesta(200, { ResponseMessage: { ResponseHeader: { Status: { StatusCode: '0' } } } }),
    );
    const g = new NequiConectaGateway({ clientId: '', clientSecret: 's', apiKey: 'k', authUrl: 'https://auth', apiUrl: 'https://api', codigoComercio: 'NIT_1' });
    await g.reembolsar({ telefono: '3001234567', monto: 1000, transaccionId: 'T' });
    const cuerpo = JSON.parse((fetchGlobal.mock.calls[1][1] as RequestInit).body as string);
    expect(cuerpo.RequestMessage.RequestHeader.ClientID).toBe('12345');
    const simulado = new NequiSimuladoGateway(60_000);
    const { transaccionId } = await simulado.solicitarCobro({ telefono: '3001234567', monto: 1000, referencia: 'r' });
    expect((await simulado.consultarEstado(transaccionId)).estado).toBe('pendiente');
  });

  it('web push con la librería por defecto y un error sin código; FCM con fetch global y un 500', async () => {
    jest.spyOn(webpush, 'sendNotification').mockRejectedValue(new Error('sin red'));
    const web = new WebPushSender({ publica: 'p', privada: 'q' }, 'mailto:a@b.co');
    expect(await web.enviar({ id_usuario: 1, plataforma: 'web', endpoint: 'https://push/x' }, { titulo: 't', cuerpo: 'c', url: '/' })).toBe(true);
    const { generateKeyPairSync } = await import('node:crypto');
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      urlDe(url).includes('oauth2') ? respuesta(200, { access_token: 'ya29', expires_in: 3600 }) : respuesta(500, {}),
    );
    const fcm = new FcmSender({ project_id: 'p', client_email: 'sa@p.iam', private_key: privateKey });
    expect(await fcm.enviar({ id_usuario: 1, plataforma: 'android', endpoint: 't' }, { titulo: 't', cuerpo: 'c', url: '/' })).toBe(true);
  });
});

describe('OpenStreetMap', () => {
  const A = { lat: 4.3369, lon: -74.3638 };
  const B = { lat: 4.4036, lon: -74.3881 };

  it('la caché vence y descarta lo más antiguo al llenarse', () => {
    const cache = new CacheTemporal<number>(2);
    const ahora = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    cache.guardar('a', 1);
    cache.guardar('b', 2);
    cache.guardar('c', 3);
    expect(cache.obtener('a')).toBeUndefined();
    expect(cache.obtener('b')).toBe(2);
    ahora.mockReturnValue(1_000 + 400 * 24 * 3_600_000);
    expect(cache.obtener('b')).toBeUndefined();
  });

  it('con fetch global: red caída, códigos ausentes y trazos en caché', async () => {
    const fetchGlobal = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => Promise.reject(new TypeError('fetch failed')));
    const osm = new OpenStreetAdapter('soporte@t.co');
    expect((await osm.trazarRuta([A, B])).exacta).toBe(false);
    // Con las coordenadas conocidas la distancia se estima por línea recta, sin ruta exacta de OSRM
    expect((await osm.calcularDistancia('Casa', 'Finca', { origen: A, destino: B })).distancia_km).toBeGreaterThan(0);
    expect(await osm.buscar('Silvania')).toEqual([]);
    fetchGlobal.mockImplementation(async () => respuesta(200, {}));
    expect((await osm.trazarRuta([A, B])).exacta).toBe(false);
    expect((await osm.calcularDistancia('Casa', 'Finca', { origen: B, destino: A })).distancia_km).toBeGreaterThan(0);
    fetchGlobal.mockImplementation(async () => respuesta(200, { code: 'Ok', routes: [{ distance: 1, duration: 1 }] }));
    expect((await osm.trazarRuta([A, A])).exacta).toBe(false);
    fetchGlobal.mockImplementation(async () => respuesta(200, { code: 'Ok', routes: [] }));
    expect((await osm.calcularDistancia('Casa', 'Finca', { origen: A, destino: A })).distancia_km).toBeGreaterThan(0);
    fetchGlobal.mockImplementation(async () =>
      respuesta(200, { code: 'Ok', routes: [{ distance: 9000, duration: 900, geometry: { coordinates: [[A.lon, A.lat], [B.lon, B.lat]] } }] }),
    );
    const ruta = await osm.trazarRuta([B, A]);
    expect(await osm.trazarRuta([B, A])).toBe(ruta);
    expect(fetchGlobal).toHaveBeenCalledTimes(9);
  });

  it('ruta por carretera: caché, HTTP con error y una sola dirección encontrada', async () => {
    let estado = 200;
    const http = jest.fn(async (url: string) => {
      if (url.includes('/search')) return respuesta(200, url.includes('Silvania') ? [{ lat: String(B.lat), lon: String(B.lon), display_name: 'Silvania' }] : []);
      return respuesta(estado, { code: 'Ok', routes: [{ distance: 9000, duration: 900 }] });
    });
    const osm = new OpenStreetAdapter('s', http as unknown as typeof fetch, 'https://osrm', 'https://nom', 0);
    const primera = await osm.calcularDistancia('Casa', 'Finca', { origen: A, destino: B });
    expect(await osm.calcularDistancia('Casa', 'Finca', { origen: A, destino: B })).toEqual(primera);
    estado = 500;
    expect((await osm.calcularDistancia('Otra', 'Más', { origen: B, destino: A })).distancia_km).toBeGreaterThan(0);
    expect(await osm.calcularDistancia('Silvania', 'Lugar inventado')).toMatchObject({ exacta: false, destino: null });
    expect(await osm.calcularDistancia('Lugar inventado', 'Silvania')).toMatchObject({ exacta: false, origen: null });
  });

  it('sin coordenadas estima la distancia; Nominatim espera su turno y se corta por tiempo', async () => {
    const http = jest.fn(async (url: string) => (url.includes('reverse') ? respuesta(503, {}) : respuesta(200, [])));
    const osm = new OpenStreetAdapter('s', http as unknown as typeof fetch, 'https://osrm', 'https://nom', 20);
    const r = await osm.calcularDistancia('Lugar inventado uno', 'Lugar inventado dos');
    expect(r).toMatchObject({ exacta: false, origen: null, destino: null });
    // Dos intentos por dirección (región y Cundinamarca), uno detrás de otro
    expect(http).toHaveBeenCalledTimes(4);
    expect(await osm.inversa(A)).toBeNull();

    jest.useFakeTimers();
    const colgado = jest.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_ok, falla) => init.signal?.addEventListener('abort', () => falla(new Error('abortado')))),
    );
    const lento = new OpenStreetAdapter('s', colgado as unknown as typeof fetch, 'https://osrm', 'https://nom', 0);
    const pendiente = lento.trazarRuta([A, B]);
    await jest.advanceTimersByTimeAsync(20_000);
    expect((await pendiente).exacta).toBe(false);
  });

  it('en modo sin red (GEO_MODO=sin-red) estima todo sin consultar servicios externos', async () => {
    const http = jest.fn(async () => respuesta(200, {}));
    const osm = new OpenStreetAdapter('s', http, 'https://osrm', 'https://nom', 0, true);
    const d = await osm.calcularDistancia('Casa', 'Finca', { origen: A, destino: B });
    expect(d).toMatchObject({ exacta: true, origen: A, destino: B });
    expect(d.distancia_km).toBeGreaterThan(0);
    expect(await osm.trazarRuta([A, B])).toMatchObject({ exacta: false, puntos: [A, B] });
    expect(await osm.buscar('Silvania')).toEqual([]);
    expect(await osm.inversa(A)).toBeNull();
    expect(http).not.toHaveBeenCalled();
  });
});

describe('seguridad, eventos y middlewares', () => {
  it('un token sin correo se acepta con correo vacío', () => {
    const servicio = new JWTService('secreto', '1h');
    const t = servicio.sign({ userId: 3, role: '2' } as never);
    expect(servicio.verify(t)).toEqual({ userId: 3, email: '', role: '2' });
  });

  it('conexiones de un usuario sin suscripciones es 0', () => {
    expect(new EventBusMemoria().conexiones(99)).toBe(0);
  });

  it('rateLimit sin IP y limpieza cuando hay demasiadas IP', () => {
    const anterior = process.env.RATE_LIMIT_DISABLED;
    process.env.RATE_LIMIT_DISABLED = 'false';
    let t = 0;
    const mw = rateLimit(1, 10, () => t);
    process.env.RATE_LIMIT_DISABLED = anterior;
    const next = jest.fn();
    const res = { setHeader: jest.fn(), status: jest.fn(() => ({ json: jest.fn() })) } as unknown as Respuesta;
    mw({ ip: undefined } as Request, res, next);
    for (let i = 0; i <= 10_001; i++) mw({ ip: `10.0.${i}` } as Request, res, next);
    t = 100;
    mw({ ip: 'nueva' } as Request, res, next);
    expect(next).toHaveBeenCalledTimes(10_004);
  });

  it('una respuesta 500 se registra como error', async () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as typeof logger;
    const app = express();
    app.use(requestLogger(log));
    app.get('/x', (_q, r) => r.status(500).end());
    await request(app).get('/x');
    expect(log.error).toHaveBeenCalled();
  });

  it('eventos del frontend: nivel que no es texto, meta no serializable y usuario como texto', () => {
    expect(normalizarEvento({ nivel: 3, mensaje: 'x' })).toBeNull();
    const e = normalizarEvento({ nivel: 'warn', mensaje: 'Hola', meta: { n: 1n }, usuario: 'ana@t.co' });
    expect(e).toMatchObject({ meta: '[meta no serializable]', usuario: 'ana@t.co' });
  });

  it('CORS: solo los orígenes configurados; sin lista, cualquiera; sin cabecera Origin no aplica', () => {
    expect(origenPermitido(['https://app.co'], 'https://app.co')).toBe(true);
    expect(origenPermitido(['https://app.co'], 'https://otro.co')).toBe(false);
    expect(origenPermitido(['https://app.co'], undefined)).toBe(true);
    expect(origenPermitido([], 'https://otro.co')).toBe(true);
  });
});

describe('tareas y migrador', () => {
  it('con intervalos por defecto informa lo publicado y no repite una tarea en curso', async () => {
    let soltar!: () => void;
    const lenta = new Promise<number>((r) => (soltar = () => r(0)));
    const info = jest.spyOn(logger, 'info');
    const c = {
      pagos: { procesarPendientes: { execute: jest.fn(() => lenta) }, generarLiquidaciones: { execute: jest.fn(async () => []) } },
      envios: { anunciarProgramados: { execute: jest.fn(async () => 2) } },
      conductores: { vencimientos: { execute: jest.fn(async () => ({ suspendidos: 1, avisados: 0 })) } },
    } as unknown as Contenedor;
    jest.useFakeTimers();
    const detener = iniciarTareas(c, logger);
    await jest.advanceTimersByTimeAsync(61_000);
    detener();
    soltar();
    expect(c.pagos.procesarPendientes.execute).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('2 envío(s) programado(s)'));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('1 conductor(es) suspendido(s)'));
  });

  it('el migrador escribe en consola por defecto', async () => {
    const consola = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const db = { query: jest.fn(async () => ({ rows: [] })) };
    await new Migrador(db as never).migrate();
    expect(consola).toHaveBeenCalled();
  });
});
