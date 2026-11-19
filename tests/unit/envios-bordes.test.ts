import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { QuoteShipmentUseCase } from '../../src/application/use-cases/catalog/catalog.use-cases';
import {
  CancelShipmentUseCase,
  CreateShipmentUseCase,
  PublicTrackingUseCase,
  RateShipmentUseCase,
  TrackShipmentUseCase,
} from '../../src/application/use-cases/shipments/client-shipments.use-cases';
import {
  AcceptShipmentUseCase,
  ArriveDestinationUseCase,
  ArrivePickupUseCase,
  CompleteStopUseCase,
  GetTrackingUseCase,
  PickupShipmentUseCase,
} from '../../src/application/use-cases/shipments/driver-shipments.use-cases';
import { ListChatUseCase, SendChatMessageUseCase } from '../../src/application/use-cases/shipments/chat.use-cases';
import { RetryNequiPaymentUseCase } from '../../src/application/use-cases/payments/payment.use-cases';
import {
  CheckDocumentExpiryUseCase,
  ListDriverHistoryUseCase,
  UploadDriverDocumentUseCase,
  presentarDocumento,
} from '../../src/application/use-cases/drivers/driver.use-cases';
import { Cotizador } from '../../src/application/services/cotizador';
import { Envio } from '../../src/domain/entities/shipment.entity';
import {
  ADMIN,
  CLIENTE,
  CONDUCTOR,
  FakeChat,
  FakeDocumentos,
  FakeDrivers,
  FakePagos,
  FakeParadas,
  FakeShipments,
  FakeVehicles,
  auditFalso,
  conductorAprobado,
  envio,
  notificacionesFalsas,
  pagosFalsos,
} from '../helpers/fakes';

const AHORA = () => new Date('2026-11-18T17:00:00Z');
const JPG = { buffer: Buffer.from([0xff, 0xd8]), mimetype: 'image/jpeg', originalname: 'f.jpg', size: 2 };
const storage = { upload: jest.fn(async () => 'https://cdn/f.jpg') };

let s: FakeShipments;
let d: FakeDrivers;
let notif: ReturnType<typeof notificacionesFalsas>;

beforeEach(() => {
  s = new FakeShipments();
  d = new FakeDrivers();
  notif = notificacionesFalsas();
  conductorAprobado(d);
});

const poner = (e: Partial<Envio>) => s.envios.set(1, envio({ id_conductor: 5, ...e }));

describe('cotización: respuesta sin zona de origen ni coordenadas', () => {
  it('devuelve null en zona de origen y coordenadas cuando no las hay', async () => {
    const cotizador = {
      cotizar: async () => ({
        ruta: { distancia_km: 3, duracion_segundos: 600, origen: null, destino: undefined, exacta: false },
        desglose: { recargo_zona: 0, total: 9000 },
        minutos: 10,
        categoria: null,
        vehiculoMinimo: 'Moto Express',
        tipoServicio: 'paquete',
        zona: { id_zona: 1, nombre_zona: 'Centro', tarifa_base: 0 },
        zonaOrigen: null,
        opciones: [],
        nocturno: false,
      }),
    } as unknown as Cotizador;
    const r = await new QuoteShipmentUseCase(cotizador).execute({ origen: 'a', destino: 'b' });
    expect(r).toMatchObject({ zona_origen: null, origen_coords: null, destino_coords: null, distancia_exacta: false });
  });
});

describe('crear envío sin coordenadas', () => {
  it('guarda null cuando la ruta no trae puntos', async () => {
    const cotizador = {
      cotizar: async () => ({
        origen: 'Casa',
        destino: 'Finca',
        ruta: { distancia_km: 3, duracion_segundos: 600, origen: null, destino: null, exacta: false },
        desglose: { recargo_zona: 0, total: 9000 },
        minutos: 10,
        categoria: null,
        tipoServicio: 'paquete',
        detalle: {},
        paradas: [],
        idaYVuelta: false,
        fechaProgramada: null,
        zona: { id_zona: 1, nombre_zona: 'Centro', tarifa_base: 0 },
      }),
    } as unknown as Cotizador;
    const pagos = pagosFalsos(s, d, notif.servicio);
    const uc = new CreateShipmentUseCase(s, cotizador, auditFalso().audit, new FakeParadas(), pagos.servicio, pagos.publicador);
    await uc.execute(CLIENTE, { origen: 'Casa', destino: 'Finca' });
    expect(s.envios.get(1)).toMatchObject({ origen_coords: null, destino_coords: null });
  });
});

describe('cliente: seguimiento, calificación y cancelación', () => {
  it('seguimiento con conductor sin vehículo', async () => {
    poner({ estado: 'Asignado', id_cliente: CLIENTE.userId });
    const r = await new TrackShipmentUseCase(s, d, new FakeVehicles(), new FakeParadas(), new FakePagos(), new FakeChat()).execute(CLIENTE, 1);
    expect(r.conductor).toMatchObject({ placa: null, vehiculo: null });
  });

  it('calificar un envío sin conductor no avisa a nadie; con una estrella usa el singular', async () => {
    const uc = new RateShipmentUseCase(s, d, auditFalso().audit, notif.servicio);
    s.envios.set(1, envio({ estado: 'Entregado', id_conductor: undefined }));
    await uc.execute(CLIENTE, 1, 4);
    expect(notif.repo.avisos).toHaveLength(0);
    s.envios.set(2, envio({ id_envio: 2, estado: 'Entregado', id_conductor: 5 }));
    await uc.execute(CLIENTE, 2, 1);
    expect(notif.repo.avisos[0].titulo).toBe('Recibiste 1 estrella');
  });

  it('el administrador cancela con motivo y el cliente sin motivo', async () => {
    const pagos = pagosFalsos(s, d, notif.servicio).servicio;
    const uc = new CancelShipmentUseCase(s, d, auditFalso().audit, notif.servicio, pagos);
    s.envios.set(1, envio({ estado: 'Pendiente', id_conductor: undefined }));
    expect((await uc.execute(CLIENTE, 1)).estado).toBe('Cancelado');
    s.envios.set(2, envio({ id_envio: 2, estado: 'Asignado', id_conductor: 5 }));
    expect((await uc.execute(ADMIN, 2, 'Cliente no responde')).estado).toBe('Cancelado');
  });

  it('enlace público: conductor y vehículo, paradas y sin mapa si se canceló', async () => {
    const paradas = new FakeParadas();
    await paradas.saveAll(1, [{ orden: 1, direccion: 'Tienda', coords: { lat: 4.3, lon: -74.3 } }]);
    const vehiculos = new FakeVehicles();
    const mapa = { porEnvio: jest.fn(async () => ({ en_vivo: false })) } as unknown as GetTrackingUseCase;
    const uc = new PublicTrackingUseCase(s, d, vehiculos, paradas, mapa);
    const token = 'tok_'.padEnd(24, 'x');
    s.envios.set(1, envio({ estado: undefined, tipo_servicio: undefined, id_conductor: 5, token_seguimiento: token }));
    const r = await uc.execute(token);
    expect(r).toMatchObject({ estado: 'Pendiente', tipo_servicio: 'paquete', conductor: { nombre: 'Con', vehiculo: null, placa: null } });
    expect(r.paradas).toEqual([{ orden: 1, direccion: 'Tienda', completada: false }]);
    s.envios.set(1, envio({ estado: 'Cancelado', id_conductor: 99, token_seguimiento: token }));
    const cancelado = await uc.execute(token);
    expect(cancelado).toMatchObject({ mapa: null, conductor: null });
  });
});

describe('conductor: aceptar, llegar, recoger, paradas y destino', () => {
  it('no puede aceptar un pendiente que ya tiene conductor', async () => {
    const pagos = pagosFalsos(s, d, notif.servicio);
    const uc = new AcceptShipmentUseCase(s, d, new FakeVehicles(), auditFalso().audit, notif.servicio, pagos.publicador, pagos.repo);
    s.envios.set(1, envio({ estado: 'Pendiente', id_conductor: 7 }));
    await expect(uc.execute(CONDUCTOR, { id_envio: 1 })).rejects.toThrow('ya fue tomado por otro conductor');
  });

  it('llegada a recoger sin código avisa que está haciendo el pedido', async () => {
    poner({ estado: 'Asignado', tipo_servicio: 'mandado' });
    await new ArrivePickupUseCase(s, d, notif.servicio, AHORA).execute(CONDUCTOR, 1);
    expect(notif.repo.avisos[0].mensaje).toContain('haciendo tu pedido #1');
  });

  it('la recogida valida tipo de foto y rango de bultos; un envío sin tipo es paquete', async () => {
    const uc = new PickupShipmentUseCase(s, d, storage, auditFalso().audit, notif.servicio, AHORA);
    poner({ estado: 'Asignado', tipo_servicio: undefined });
    await expect(uc.execute(CONDUCTOR, 1, { ...JPG, mimetype: 'image/gif' }, {})).rejects.toThrow('JPG, PNG o WebP');
    await expect(uc.execute(CONDUCTOR, 1, JPG, { bultos: 0 })).rejects.toThrow('"bultos" debe estar entre 1');
    const r = await uc.execute(CONDUCTOR, 1, JPG, {});
    expect(r.estado).toBe('En Ruta');
  });

  it('paradas: devuelve la fecha de las completadas y nada si no la tiene', async () => {
    const paradas = new FakeParadas();
    await paradas.saveAll(1, [
      { orden: 1, direccion: 'A', coords: { lat: 4.3, lon: -74.3 } },
      { orden: 2, direccion: 'B', coords: { lat: 4.3, lon: -74.3 } },
    ]);
    poner({ estado: 'En Ruta' });
    const r = await new CompleteStopUseCase(s, d, paradas, notif.servicio, AHORA).execute(CONDUCTOR, 1, 1);
    expect(r.paradas.map((p) => p.completada_en)).toEqual([AHORA().toISOString(), null]);
  });

  it('en ida y vuelta la llegada final es al origen', async () => {
    poner({ estado: 'En Ruta', ida_y_vuelta: true, destino_visitado_en: new Date(), origen: 'Casa', destino: 'Banco' });
    await new ArriveDestinationUseCase(s, d, notif.servicio, AHORA).execute(CONDUCTOR, 1);
    expect(notif.repo.avisos[0].mensaje).toContain('Está en Casa');
  });

  it('el mapa trata un envío sin estado como pendiente', async () => {
    const uc = new GetTrackingUseCase(s, d, { findTrail: async () => [], findLast: async () => null, save: async () => true } as never, AHORA);
    expect((await uc.porEnvio(envio({ estado: undefined }))).estado).toBe('Pendiente');
  });
});

describe('pagos y chat', () => {
  it('reintentar Nequi cuenta intentos desde cero y usa el teléfono guardado', async () => {
    const pagos = pagosFalsos(s, d, notif.servicio);
    s.envios.set(1, envio({ estado: 'Pendiente', id_cliente: CLIENTE.userId }));
    await pagos.repo.create({ id_envio: 1, metodo: 'nequi', estado: 'rechazado', monto: 1000, telefono: '3001234567' });
    const uc = new RetryNequiPaymentUseCase(s, pagos.repo, pagos.servicio, auditFalso().audit);
    expect((await uc.execute(CLIENTE, 1, {}))?.estado).toBe('pendiente');
  });

  it('chat: sin estado está cerrado; autor sin nombre y mensaje del conductor sin perfil', async () => {
    const chat = new FakeChat();
    s.envios.set(1, envio({ estado: undefined, id_cliente: CLIENTE.userId, id_conductor: 5 }));
    await chat.save({ id_envio: 1, id_usuario: CONDUCTOR.userId, texto: 'Hola' });
    chat.mensajes[0].creado = undefined;
    const lista = await new ListChatUseCase(s, d, chat).execute(CLIENTE, 1);
    expect(lista).toMatchObject({ abierto: false, mensajes: [{ autor: null, fecha: expect.any(String) }] });
    const users = { findById: async () => null } as never;
    const enviar = new SendChatMessageUseCase(s, d, users, chat, notif.servicio);
    await expect(enviar.execute(CLIENTE, 1, { texto: 'hola' })).rejects.toThrow('El chat está disponible');
    s.envios.set(1, envio({ estado: 'En Ruta', id_cliente: CLIENTE.userId, id_conductor: 5 }));
    const push = jest.spyOn(notif.servicio, 'push');
    await enviar.execute(CONDUCTOR, 1, { texto: 'Voy llegando' });
    expect(push).toHaveBeenCalledWith(CLIENTE.userId, expect.stringContaining('Tu conductor'), 'Voy llegando', expect.any(String), expect.any(String));
  });
});

describe('documentos del conductor', () => {
  it('presenta un documento sin estado ni fecha de subida', () => {
    expect(presentarDocumento({ id: 1, tipo_documento: 'Cédula', url_archivo: 'u', id_conductor: 5 }, AHORA())).toMatchObject({
      estado: 'Pendiente',
      fecha_subida: null,
      motivo_rechazo: null,
    });
  });

  it('al subir un documento que el repositorio guarda sin estado lo presenta como pendiente', async () => {
    const docs = new FakeDocumentos();
    jest.spyOn(docs, 'create').mockImplementation(async (n) => ({ ...n, id: 3 }));
    const uc = new UploadDriverDocumentUseCase(docs, d, storage, auditFalso().audit, AHORA);
    expect((await uc.execute(CONDUCTOR, { tipo_documento: 'Cédula' }, JPG)).estado).toBe('Pendiente');
  });

  it('vencimientos: documentos sin fecha no suspenden y un tipo desconocido se nombra tal cual', async () => {
    const docs = new FakeDocumentos();
    jest.spyOn(docs, 'findVigilados').mockImplementation(async () => [
      { id: 1, tipo_documento: 'Cédula', url_archivo: 'u', id_conductor: 5 },
      { id: 2, tipo_documento: 'Pasaporte' as never, url_archivo: 'u', id_conductor: 5, fecha_vencimiento: new Date('2026-11-01T00:00:00Z') },
    ]);
    const uc = new CheckDocumentExpiryUseCase(docs, d, auditFalso().audit, notif.servicio, AHORA);
    expect(await uc.execute()).toEqual({ suspendidos: 1, avisados: 0 });
    expect(notif.repo.avisos[0].mensaje).toContain('Venció: Pasaporte');
  });

  it('historial con límite por defecto o inválido', async () => {
    const uc = new ListDriverHistoryUseCase(d, s);
    const spy = jest.spyOn(s, 'findDriverHistory') as unknown as jest.Mock<(id: number, limite: number) => Promise<Envio[]>>;
    await uc.execute(CONDUCTOR);
    await uc.execute(CONDUCTOR, 'x');
    expect(spy.mock.calls.map((c) => c[1])).toEqual([50, 50]);
  });
});
