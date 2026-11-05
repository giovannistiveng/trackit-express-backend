import { generateKeyPairSync } from 'crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { NotificationService, rutaNotificacion } from '../../src/application/services/notification.service';
import { PushService } from '../../src/application/services/push.service';
import { Cotizador, TARIFAS_POR_DEFECTO, fechaProgramadaValida, paradasValidas } from '../../src/application/services/cotizador';
import { celularNequi, horaCorta, metodoPagoValido, presentarPago } from '../../src/application/services/pagos.service';
import { correoContrasenaCambiada, correoRecuperacion, correoVerificacion } from '../../src/application/services/plantillas-correo';
import { hashToken, nuevoToken } from '../../src/application/use-cases/auth/account-recovery.use-cases';
import { hoyColombia, lunesDe } from '../../src/application/use-cases/payments/payment.use-cases';
import { SubscribePushUseCase } from '../../src/application/use-cases/realtime/push.use-cases';
import { pagoPermitePublicar } from '../../src/domain/entities/pago.entity';
import { calcularTarifaDetallada } from '../../src/domain/services/tarifas';
import { BuzonLocalMailer, SmtpMailer, ocultarCorreo } from '../../src/infrastructure/external/mailers';
import { ErrorPasarela, NequiConectaGateway, NequiSimuladoGateway, estadoNequi } from '../../src/infrastructure/external/nequi.gateways';
import { EventBusMemoria } from '../../src/infrastructure/realtime/event-bus';
import { FcmSender, WebPushSender, cargaAngular, clavesVapid } from '../../src/infrastructure/realtime/push.senders';
import { TicketsEventos, VIGENCIA_TICKET_MS } from '../../src/infrastructure/realtime/tickets';
import { iniciarTareas } from '../../src/infrastructure/jobs';
import { ValidationError } from '../../src/shared/errors';
import { CLIENTE, FakeDrivers, FakeShipments, envio, notificacionesFalsas, pagosFalsos, pasarelaFalsa } from '../helpers/fakes';
import { logger } from '../../src/shared/logger';
import { Contenedor } from '../../src/infrastructure/container';

const respuesta = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo }) as Response;
const nequiOk = (any: unknown) => respuesta(200, { ResponseMessage: { ResponseHeader: { Status: { StatusCode: '0', StatusDesc: 'SUCCESS' } }, ResponseBody: { any } } });

describe('Nequi Conecta', () => {
  const cfg = { clientId: 'cliente', clientSecret: 'secreto', apiKey: 'llave', authUrl: 'https://auth', apiUrl: 'https://api', codigoComercio: 'NIT_1' };

  it('obtiene el token una vez, cobra, consulta y reembolsa con el formato de Nequi', async () => {
    const llamadas: { url: string; init: RequestInit }[] = [];
    const http = jest.fn(async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      if (url.startsWith('https://auth')) return respuesta(200, { access_token: 'tok', expires_in: 3600 });
      if (url.includes('unregisteredpayment')) return nequiOk({ unregisteredPaymentRS: { transactionId: ' 350-123 ' } });
      if (url.includes('getstatuspayment')) return nequiOk({ getStatusPaymentRS: { status: '35' } });
      return nequiOk({});
    });
    const g = new NequiConectaGateway(cfg, http as unknown as typeof fetch, () => 1_000_000);
    expect(await g.solicitarCobro({ telefono: '3001234567', monto: 15400.4, referencia: 'TrackIt envío 7' })).toEqual({ transaccionId: '350-123' });
    expect(await g.consultarEstado('350-123')).toEqual({ estado: 'aprobado' });
    await g.reembolsar({ telefono: '3001234567', monto: 15400, transaccionId: '350-123' });
    expect(llamadas.filter((l) => l.url.startsWith('https://auth'))).toHaveLength(1);
    expect(llamadas[0].init.headers).toMatchObject({ Authorization: `Basic ${Buffer.from('cliente:secreto').toString('base64')}` });
    const cobro = JSON.parse(String(llamadas[1].init.body));
    expect(llamadas[1].init.headers).toMatchObject({ Authorization: 'Bearer tok', 'x-api-key': 'llave' });
    expect(cobro.RequestMessage.RequestHeader.Destination).toMatchObject({ ServiceName: 'PaymentsService', ServiceOperation: 'unregisteredPayment' });
    expect(cobro.RequestMessage.RequestBody.any.unregisteredPaymentRQ).toMatchObject({ phoneNumber: '3001234567', code: 'NIT_1', value: '15400' });
    expect(JSON.parse(String(llamadas[3].init.body)).RequestMessage.RequestBody.any.reversionRQ).toMatchObject({ messageId: '350-123', type: 'payment' });
  });

  it('traduce estados y errores', async () => {
    expect([estadoNequi('35'), estadoNequi('33'), estadoNequi('10-454'), estadoNequi('10-455'), estadoNequi(undefined)]).toEqual([
      'aprobado',
      'pendiente',
      'expirado',
      'rechazado',
      'rechazado',
    ]);
    const sinAuth = new NequiConectaGateway(cfg, (async () => respuesta(401, {})) as unknown as typeof fetch);
    await expect(sinAuth.consultarEstado('x')).rejects.toThrow('No se pudo autenticar con Nequi (HTTP 401)');
    const conError = new NequiConectaGateway(cfg, (async (url: string) =>
      url.startsWith('https://auth')
        ? respuesta(200, { access_token: 't' })
        : respuesta(200, { ResponseMessage: { ResponseHeader: { Status: { StatusCode: '20-07A', StatusDesc: 'Cliente no existe' } } } })) as unknown as typeof fetch);
    await expect(conError.solicitarCobro({ telefono: '3', monto: 1, referencia: 'r' })).rejects.toMatchObject({ message: 'Cliente no existe', codigo: '20-07A' });
    const sinId = new NequiConectaGateway(cfg, (async (url: string) => (url.startsWith('https://auth') ? respuesta(200, { access_token: 't' }) : nequiOk({}))) as unknown as typeof fetch);
    await expect(sinId.solicitarCobro({ telefono: '3', monto: 1, referencia: 'r' })).rejects.toBeInstanceOf(ErrorPasarela);
    const roto = new NequiConectaGateway(cfg, (async (url: string) =>
      url.startsWith('https://auth') ? respuesta(200, { access_token: 't' }) : ({ ok: false, status: 502, json: async () => Promise.reject(new Error('html')) } as unknown as Response)) as unknown as typeof fetch);
    await expect(roto.consultarEstado('x')).rejects.toThrow('Nequi no pudo procesar la solicitud');
  });

  it('modo simulado: aprueba con el tiempo y respeta los celulares de prueba', async () => {
    let t = 0;
    const g = new NequiSimuladoGateway(5000, () => t);
    const ok = await g.solicitarCobro({ telefono: '3001234567', monto: 1000, referencia: 'r' });
    expect((await g.consultarEstado(ok.transaccionId)).estado).toBe('pendiente');
    t = 5000;
    expect((await g.consultarEstado(ok.transaccionId)).estado).toBe('aprobado');
    const no = await g.solicitarCobro({ telefono: '3001230000', monto: 1, referencia: 'r' });
    expect((await g.consultarEstado(no.transaccionId)).estado).toBe('rechazado');
    const expira = await g.solicitarCobro({ telefono: '3001239999', monto: 1, referencia: 'r' });
    expect((await g.consultarEstado(expira.transaccionId)).estado).toBe('pendiente');
    t = 20_000;
    expect((await g.consultarEstado(expira.transaccionId)).estado).toBe('expirado');
    expect((await g.consultarEstado('SIM-NADA')).estado).toBe('rechazado');
    await expect(g.solicitarCobro({ telefono: '3000000000', monto: 1, referencia: 'r' })).rejects.toThrow('no está disponible');
    await expect(g.reembolsar({ telefono: '3001234567', monto: 1, transaccionId: ok.transaccionId })).resolves.toBeUndefined();
  });
});

describe('PagosService', () => {
  it('vence un cobro sin respuesta y reembolsa si el cliente pagó después de cancelar', async () => {
    const envios = new FakeShipments();
    const drivers = new FakeDrivers();
    const { repo: avisos, servicio } = notificacionesFalsas();
    const pasarela = pasarelaFalsa('pendiente');
    let ahora = new Date('2026-11-02T15:00:00Z');
    const p = pagosFalsos(envios, drivers, servicio, pasarela);
    (p.servicio as unknown as { reloj: () => Date }).reloj = () => ahora;
    envios.envios.set(1, envio({ id_envio: 1, tarifa: 9000 }));
    const pago = await p.servicio.iniciar(envios.envios.get(1)!, 'nequi', '3001234567');
    expect(pago).toMatchObject({ estado: 'pendiente', transaccion_id: 'T1' });
    expect((await p.servicio.actualizar(pago)).estado).toBe('pendiente');
    ahora = new Date(pago.actualizado!.getTime() + 11 * 60_000);
    expect((await p.servicio.actualizar((await p.repo.findByEnvio(1))!)).estado).toBe('expirado');
    expect(avisos.avisos.at(-1)).toMatchObject({ tipo: 'pago_rechazado', titulo: 'El cobro de Nequi venció' });

    envios.envios.set(2, envio({ id_envio: 2, estado: 'Cancelado' }));
    const p2 = await p.servicio.iniciar(envios.envios.get(2)!, 'nequi', '3001234567');
    pasarela.estado = 'aprobado';
    expect((await p.servicio.actualizar(p2)).estado).toBe('reembolsado');
    expect(pasarela.reembolsos).toBe(1);
    // Sin cambios: efectivo, ya aprobado o la pasarela falla
    expect(await p.servicio.actualizar({ ...p2, metodo: 'efectivo' })).toMatchObject({ metodo: 'efectivo' });
    pasarela.consultarEstado = async () => Promise.reject(new Error('caída'));
    const p3 = await p.servicio.iniciar(envio({ id_envio: 3 }), 'nequi', '3001234567');
    expect((await p.servicio.actualizar(p3)).estado).toBe('pendiente');
    expect(await p.servicio.alCancelar(99)).toBeNull();
  });

  it('validaciones y presentación', () => {
    expect(celularNequi('+57 300-123 4567')).toBe('3001234567');
    expect(() => celularNequi('2001234567')).toThrow(ValidationError);
    expect(metodoPagoValido(undefined)).toBe('efectivo');
    expect(presentarPago(null)).toBeNull();
    expect(presentarPago({ id_envio: 1, metodo: 'efectivo', estado: 'por_cobrar', monto: 1 })).toMatchObject({ telefono: null, actualizado: null });
    expect(pagoPermitePublicar(null)).toBe(true);
    expect(pagoPermitePublicar({ metodo: 'nequi', estado: 'pendiente' })).toBe(false);
    expect(horaCorta(new Date('2026-11-02T20:30:00Z'))).toMatch(/3:30/);
  });
});

describe('Cotizador: paradas, ida y vuelta y programados', () => {
  const zonas = {
    findAll: async () => [{ id_zona: 1, nombre_zona: 'Centro', tarifa_base: 0, centro: { lat: 4.3365, lon: -74.3638 }, radio_km: 20 }],
    findById: async () => null,
    updateTarifa: async () => null,
    create: async () => Promise.reject(new Error()),
    update: async () => null,
    remove: async () => null,
  };
  const tarifas = { findAll: async () => TARIFAS_POR_DEFECTO, update: async () => null };

  it('sin coordenadas exactas no admite paradas ni ida y vuelta', async () => {
    const aproximada = { calcularDistancia: async () => ({ distancia_km: 5, duracion_segundos: 600, origen: null, destino: null, exacta: false }) };
    const c = new Cotizador(zonas, tarifas, aproximada, () => new Date('2026-11-02T17:00:00Z'));
    await expect(c.cotizar({ origen: 'A casa', destino: 'B casa', id_zona: 1, ida_y_vuelta: true })).rejects.toThrow('ubica el origen y el destino en el mapa');
  });

  it('el recargo nocturno se calcula con la hora programada', async () => {
    const fija = { calcularDistancia: async () => ({ distancia_km: 5, duracion_segundos: 600, origen: { lat: 4.34, lon: -74.36 }, destino: { lat: 4.35, lon: -74.37 }, exacta: true }) };
    const c = new Cotizador(zonas, tarifas, fija, () => new Date('2026-11-02T17:00:00Z'));
    const noche = await c.cotizar({ origen: 'A casa', destino: 'B casa', fecha_programada: '2026-11-03T02:00:00Z' });
    expect(noche.nocturno).toBe(true);
    expect(noche.desglose.recargo_nocturno).toBeGreaterThan(0);
  });

  it('valida paradas y fechas', () => {
    expect(paradasValidas(null)).toEqual([]);
    expect(() => paradasValidas([null])).toThrow('Ubica en el mapa la parada 1');
    const ahora = new Date('2026-11-02T12:00:00Z');
    expect(fechaProgramadaValida('', ahora)).toBeNull();
    expect(fechaProgramadaValida('2026-11-02T13:00:00Z', ahora)?.toISOString()).toBe('2026-11-02T13:00:00.000Z');
    const d = calcularTarifaDetallada({ tarifa: TARIFAS_POR_DEFECTO[0], distanciaKm: 5, minutos: 10, recargoZona: 0, paradas: 2.7, fecha: ahora });
    expect(d).toMatchObject({ paradas: 2, recargo_paradas: 3000 });
  });
});

describe('Correo', () => {
  it('SMTP envía con el remitente; el buzón local guarda el HTML y registra el enlace', async () => {
    const sendMail = jest.fn(async () => ({}));
    const smtp = new SmtpMailer({ host: 'h', port: 587, secure: false, user: 'u', pass: 'p', remitente: 'TrackIt <a@b.co>' }, { sendMail } as never);
    await smtp.enviar(correoVerificacion('ana@t.co', 'Ana Ruiz', 'http://x/verificar?token=abc'));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'TrackIt <a@b.co>', to: 'ana@t.co', subject: 'Confirma tu correo en TrackIt Express' }));
    expect(new SmtpMailer({ host: 'h', port: 465, secure: true, user: '', pass: '', remitente: 'x' })).toBeInstanceOf(SmtpMailer);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'buzon-'));
    await new BuzonLocalMailer(dir).enviar(correoRecuperacion('ana@t.co', 'Ana', 'http://x/r?token=1'));
    await new BuzonLocalMailer(dir).enviar(correoContrasenaCambiada('ana@t.co', 'Ana'));
    const archivos = readdirSync(dir);
    expect(archivos).toHaveLength(2);
    expect(readFileSync(path.join(dir, archivos[0]), 'utf8')).toContain('TrackIt');
    expect(ocultarCorreo('laura@t.co')).toBe('la***@t.co');
    // Los textos del usuario se escapan en el HTML
    expect(correoVerificacion('a@b.co', '<b>Hack</b>', 'http://x').html).toContain('&lt;b&gt;Hack&lt;/b&gt;');
  });

  it('tokens: aleatorios y solo se guarda el hash', () => {
    const a = nuevoToken();
    expect(a.token).toMatch(/^[\w-]{43}$/);
    expect(a.hash).toBe(hashToken(a.token));
    expect(nuevoToken().token).not.toBe(a.token);
  });
});

describe('Push y tiempo real', () => {
  it('WebPush: envía la carga de Angular y detecta suscripciones vencidas', async () => {
    const enviar = jest.fn(async () => ({}));
    const sender = new WebPushSender({ publica: 'pub', privada: 'priv' }, 'mailto:a@b.co', enviar);
    const sub = { id_usuario: 1, plataforma: 'web' as const, endpoint: 'https://p/1', p256dh: 'k', auth: 'a' };
    const m = { titulo: 'Hola', cuerpo: 'Mundo', url: '/envios/5', etiqueta: 'envio-5' };
    expect(await sender.enviar(sub, m)).toBe(true);
    expect(JSON.parse((enviar.mock.calls[0] as unknown[])[1] as string)).toEqual(cargaAngular(m));
    expect(cargaAngular(m).notification.data.onActionClick.default.url).toBe('/envios/5');
    enviar.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    expect(await sender.enviar(sub, m)).toBe(false);
    enviar.mockRejectedValueOnce(Object.assign(new Error('x'), { statusCode: 500 }));
    expect(await sender.enviar({ ...sub, p256dh: null, auth: null }, m)).toBe(true);
  });

  it('claves VAPID: usa las de .env, si no las genera una vez y las reutiliza', () => {
    expect(clavesVapid('a', 'b')).toEqual({ publica: 'a', privada: 'b' });
    const archivo = path.join(mkdtempSync(path.join(os.tmpdir(), 'vapid-')), '.vapid.json');
    const k = clavesVapid('', '', archivo);
    expect(existsSync(archivo)).toBe(true);
    expect(clavesVapid('', '', archivo)).toEqual(k);
    writeFileSync(archivo, 'dañado');
    expect(clavesVapid('', '', archivo).publica).not.toBe(k.publica);
    expect(clavesVapid('', '', path.join('/no/existe/dir', 'v.json')).publica).toEqual(expect.any(String));
  });

  const estadoFcm = (url: string) => (url.includes('malo') ? 404 : 200);

  it('FCM: firma la cuenta de servicio, cachea el token y limpia tokens inválidos', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    const http = jest.fn(async (url: string) =>
      url.includes('oauth2') ? respuesta(200, { access_token: 'ya29', expires_in: 3600 }) : respuesta(estadoFcm(url), {}),
    );
    const fcm = new FcmSender({ project_id: 'trackit', client_email: 'sa@trackit.iam', private_key: privateKey }, http as unknown as typeof fetch);
    const m = { titulo: 'T', cuerpo: 'C', url: '/' };
    expect(await fcm.enviar({ id_usuario: 1, plataforma: 'android', endpoint: 'token-1' }, m)).toBe(true);
    expect(await fcm.enviar({ id_usuario: 1, plataforma: 'android', endpoint: 'token-2' }, m)).toBe(true);
    expect(http.mock.calls.filter((c) => String(c[0]).includes('oauth2'))).toHaveLength(1);
    const malo = new FcmSender({ project_id: 'malo', client_email: 'x', private_key: privateKey }, http as unknown as typeof fetch);
    expect(await malo.enviar({ id_usuario: 1, plataforma: 'ios', endpoint: 't' }, m)).toBe(false);
    const sinPermiso = new FcmSender({ project_id: 'p', client_email: 'x', private_key: privateKey }, (async () => respuesta(403, {})) as unknown as typeof fetch);
    await expect(sinPermiso.enviar({ id_usuario: 1, plataforma: 'ios', endpoint: 't' }, m)).rejects.toThrow('Firebase rechazó');
    expect(FcmSender.desdeArchivo('')).toBeNull();
    expect(FcmSender.desdeArchivo('/no/existe.json')).toBeNull();
  });

  it('PushService reparte por plataforma y nunca lanza', async () => {
    const borrados: string[] = [];
    const repo = {
      save: async () => undefined,
      findByUser: async () => [
        { id_usuario: 1, plataforma: 'web' as const, endpoint: 'w' },
        { id_usuario: 1, plataforma: 'ios' as const, endpoint: 'i' },
      ],
      delete: async (e: string) => {
        borrados.push(e);
      },
    };
    const fallos: unknown[] = [];
    const web = { plataformas: ['web' as const], enviar: async () => false };
    const svc = new PushService(repo, [web], (e) => fallos.push(e));
    await svc.enviar(1, { titulo: 't', cuerpo: 'c', url: '/' });
    expect(borrados).toEqual(['w']);
    await new PushService(repo, [{ plataformas: ['web'], enviar: async () => Promise.reject(new Error('x')) }], (e) => fallos.push(e)).enviar(1, { titulo: 't', cuerpo: 'c', url: '/' });
    await new PushService({ ...repo, findByUser: async () => Promise.reject(new Error('bd')) }, [web], (e) => fallos.push(e)).enviar(1, { titulo: 't', cuerpo: 'c', url: '/' });
    expect(fallos).toHaveLength(2);
    expect(new PushService(repo, []).disponible).toBe(false);
    await new PushService(repo, []).enviar(1, { titulo: 't', cuerpo: 'c', url: '/' });
  });

  it('NotificationService publica en el bus y define la ruta de la notificación', async () => {
    const bus = new EventBusMemoria();
    const recibidos: unknown[] = [];
    const quitar = bus.suscribir(5, (e) => recibidos.push(e));
    bus.suscribir(5, () => {
      throw new Error('conexión rota');
    });
    const repo = { save: async () => Promise.reject(new Error('bd')), findByUser: async () => [], countUnread: async () => 0, markRead: async () => true, markAllRead: async () => 0, delete: async () => true, deleteRead: async () => 0 };
    const fallos: unknown[] = [];
    const n = new NotificationService(repo, (e) => fallos.push(e), { bus });
    await n.notificar({ id_usuario: 5, tipo: 'envio_aceptado', titulo: 'x'.repeat(200), mensaje: 'm', id_envio: 3 });
    n.emitir(5, 'chat', { hola: 1 });
    await n.push(5, 't', 'c', '/');
    expect(recibidos).toHaveLength(2);
    expect(fallos).toHaveLength(1);
    expect(bus.conexiones(5)).toBe(2);
    quitar();
    expect(bus.conexiones()).toBe(1);
    expect(rutaNotificacion({ tipo: 'nuevo_servicio' })).toBe('/conductor/tablero');
    expect(rutaNotificacion({ tipo: 'liquidacion' })).toBe('/conductor/ganancias');
    expect(rutaNotificacion({ tipo: 'conductor_aprobado' })).toBe('/conductor/perfil');
    expect(rutaNotificacion({ tipo: 'envio_aceptado', id_envio: 4 })).toBe('/envios/4');
    expect(rutaNotificacion({ tipo: 'envio_aceptado' })).toBe('/');
  });

  it('tickets de un solo uso que vencen', () => {
    let t = 0;
    const tickets = new TicketsEventos(() => t);
    const a = tickets.emitir(CLIENTE);
    expect(tickets.canjear(a)).toEqual(CLIENTE);
    expect(tickets.canjear(a)).toBeNull();
    const b = tickets.emitir(CLIENTE);
    t = VIGENCIA_TICKET_MS + 1;
    tickets.emitir(CLIENTE); // limpia los vencidos
    expect(tickets.canjear(b)).toBeNull();
    expect(tickets.canjear(42)).toBeNull();
  });

  it('suscripción push: valida la plataforma y el formato', async () => {
    const guardados: unknown[] = [];
    const uc = new SubscribePushUseCase({ save: async (s) => {
        guardados.push(s);
      }, findByUser: async () => [], delete: async () => undefined });
    await uc.execute(CLIENTE, { plataforma: 'ios', token: 'apns-fcm-token-1234567890' });
    expect(guardados).toEqual([{ id_usuario: CLIENTE.userId, plataforma: 'ios', endpoint: 'apns-fcm-token-1234567890' }]);
    await expect(uc.execute(CLIENTE, { endpoint: 'https://push.x/abcdefghij', keys: { p256dh: 1 } })).rejects.toThrow(ValidationError);
  });
});

describe('Tareas en segundo plano y fechas', () => {
  it('ejecuta cada tarea, no se solapa y un error no detiene las demás', async () => {
    const pagos = jest.fn(async () => 2);
    const programados = jest.fn(async () => Promise.reject(new Error('bd')));
    const liquidaciones = jest.fn(async () => [{}]);
    const c = { pagos: { procesarPendientes: { execute: pagos }, generarLiquidaciones: { execute: liquidaciones } }, envios: { anunciarProgramados: { execute: programados } } } as unknown as Contenedor;
    const detener = iniciarTareas(c, logger.child('Prueba'), { pagosMs: 10, programadosMs: 10, liquidacionesMs: 10 });
    await new Promise((r) => setTimeout(r, 60));
    detener();
    expect(pagos).toHaveBeenCalled();
    expect(programados).toHaveBeenCalled();
    expect(liquidaciones).toHaveBeenCalled();
  });

  it('semanas de lunes a domingo en hora de Colombia', () => {
    expect(lunesDe(new Date('2026-11-04T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-11-02');
    expect(lunesDe(new Date('2026-11-08T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-11-02');
    // 2 de noviembre a las 2 a. m. UTC todavía es 1 de noviembre en Colombia
    expect(hoyColombia(new Date('2026-11-02T02:00:00Z')).toISOString().slice(0, 10)).toBe('2026-11-01');
  });
});
