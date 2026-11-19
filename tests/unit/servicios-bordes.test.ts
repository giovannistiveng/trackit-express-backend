import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { exigirEstado } from '../../src/application/services/access';
import { Cotizador } from '../../src/application/services/cotizador';
import { NotificationService } from '../../src/application/services/notification.service';
import { PagosService, PublicadorEnvios, celularNequi } from '../../src/application/services/pagos.service';
import { PushService } from '../../src/application/services/push.service';
import { DistancePort } from '../../src/domain/ports/services.port';
import { ZonaTarifa } from '../../src/domain/entities/zona-tarifa.entity';
import * as servicios from '../../src/domain/services/servicios';
import { zonaDelPunto } from '../../src/domain/services/tarifas';
import { evaluarRequisitos, fechaVencimientoValida, ultimoPorTipo } from '../../src/domain/services/verificacion';
import { ValidationError } from '../../src/shared/errors';
import { FakeDrivers, FakePagos, FakeShipments, envio, notificacionesFalsas, pasarelaFalsa } from '../helpers/fakes';

const AHORA = () => new Date();

afterEach(() => {
  jest.restoreAllMocks();
});

describe('reglas pequeñas de acceso y dominio', () => {
  it('exigirEstado trata un envío sin estado como Pendiente', () => {
    expect(() => exigirEstado(envio({ estado: undefined }), ['Pendiente'], 'x')).not.toThrow();
    expect(() => exigirEstado(envio({ estado: undefined }), ['Asignado'], 'no')).toThrow('no');
    expect(new ValidationError().message).toBe('Error de validación');
  });

  it('un trasteo sin ayudantes ni pisos usa los valores por defecto', () => {
    const d = servicios.detalleValido('trasteo', { objetos: 'Cama' });
    expect(d).toMatchObject({ pisos_origen: 1, pisos_destino: 1, ascensor_origen: false, ayudantes: 0 });
    expect(servicios.extrasServicio('trasteo', {})).toEqual([]);
  });

  it('zonaDelPunto ignora zonas sin radio y elige la más pequeña', () => {
    const p = { lat: 4.3369, lon: -74.3638 };
    const zonas: ZonaTarifa[] = [
      { id_zona: 1, nombre_zona: 'Sin radio', tarifa_base: 0, centro: p },
      { id_zona: 2, nombre_zona: 'Grande', tarifa_base: 0, centro: p, radio_km: 9 },
      { id_zona: 3, nombre_zona: 'Pequeña', tarifa_base: 0, centro: p, radio_km: 2 },
    ];
    expect(zonaDelPunto(zonas, p)?.nombre_zona).toBe('Pequeña');
  });

  it('documentos: desempata por id, estado por defecto y fechas imposibles', () => {
    const mapa = ultimoPorTipo([
      { id: 1, tipo_documento: 'SOAT', url_archivo: 'a', id_conductor: 1 },
      { id: 2, tipo_documento: 'SOAT', url_archivo: 'b', id_conductor: 1 },
      { tipo_documento: 'Cédula', url_archivo: 'c', id_conductor: 1 },
      { tipo_documento: 'Cédula', url_archivo: 'd', id_conductor: 1 },
    ]);
    expect(mapa.get('SOAT')?.id).toBe(2);
    expect(mapa.get('Cédula')?.url_archivo).toBe('c');
    const r = evaluarRequisitos([{ tipo_documento: 'Cédula', url_archivo: 'c', id_conductor: 1 }], true, new Date());
    expect(r.items.find((i) => i.tipo === 'Cédula')?.estado).toBe('pendiente');
    expect(fechaVencimientoValida('2027-13-45', new Date('2026-11-18T00:00:00Z'))).toBeNull();
  });
});

describe('Cotizador: tarifas y errores inesperados', () => {
  const zonas = {
    findById: async () => ({ id_zona: 1, nombre_zona: 'Centro', tarifa_base: 0, centro: null }),
    findAll: async () => [],
    updateTarifa: async () => null,
    create: async () => null as never,
    update: async () => null,
  } as never;
  const distancia: DistancePort = {
    calcularDistancia: async () => ({ distancia_km: 5, duracion_segundos: 600, origen: null, destino: null, exacta: false }),
  };
  const furgoneta = { categoria: 'Furgoneta' as const, banderazo: 12000, por_km: 1800, por_minuto: 150, minimo: 22000 };
  const moto = { categoria: 'Moto Express' as const, banderazo: 2000, por_km: 700, por_minuto: 50, minimo: 4500 };

  it('si falta la tarifa del vehículo mínimo usa la del siguiente que puede llevarlo', async () => {
    const c = new Cotizador(zonas, { findAll: async () => [furgoneta], update: async () => furgoneta }, distancia);
    const r = await c.cotizar({ origen: 'Centro', destino: 'Finca', id_zona: 1 });
    expect(r.desglose.categoria).toBe('Furgoneta');
  });

  it('con la tabla de tarifas vacía usa las tarifas por defecto', async () => {
    const c = new Cotizador(zonas, { findAll: async () => [], update: async () => furgoneta }, distancia);
    expect((await c.cotizar({ origen: 'Centro', destino: 'Finca', id_zona: 1 })).desglose.total).toBeGreaterThan(0);
  });

  it('sin ninguna tarifa para el servicio lo informa', async () => {
    const c = new Cotizador(zonas, { findAll: async () => [moto], update: async () => furgoneta }, distancia);
    await expect(
      c.cotizar({ origen: 'Casa', destino: 'Apartamento', id_zona: 1, tipo_servicio: 'trasteo', detalle_servicio: { objetos: 'Cama' } }),
    ).rejects.toThrow('No hay tarifas para los vehículos');
  });

  it('un error que no es de validación del detalle se propaga tal cual', async () => {
    jest.spyOn(servicios, 'detalleValido').mockImplementation(() => {
      throw new TypeError('inesperado');
    });
    const c = new Cotizador(zonas, { findAll: async () => [moto], update: async () => furgoneta }, distancia);
    await expect(c.cotizar({ origen: 'Centro', destino: 'Finca', id_zona: 1 })).rejects.toThrow(TypeError);
  });
});

describe('Notificaciones y push sin manejador de fallos', () => {
  it('un fallo al guardar no rompe nada aunque nadie lo escuche', async () => {
    const repo = notificacionesFalsas().repo;
    const s = new NotificationService({ ...repo, save: async () => Promise.reject(new Error('bd')) } as never);
    await expect(s.notificar({ id_usuario: 1, tipo: 'nuevo_servicio', titulo: 't', mensaje: 'm' })).resolves.toBeUndefined();
    const push = new PushService(
      { findByUser: async () => Promise.reject(new Error('bd')) } as never,
      [{ plataformas: ['web'], enviar: async () => true } as never],
    );
    await expect(push.enviar(1, { titulo: 't', cuerpo: 'c', url: '/' })).resolves.toBeUndefined();
  });
});

describe('Pagos: casos borde', () => {
  function armar(pasarela = pasarelaFalsa()) {
    const envios = new FakeShipments();
    const drivers = new FakeDrivers();
    const { servicio } = notificacionesFalsas();
    const repo = new FakePagos();
    const publicador = new PublicadorEnvios(envios, drivers, servicio, AHORA);
    return { envios, drivers, repo, pasarela, servicio: new PagosService(repo, pasarela, envios, publicador, servicio, AHORA) };
  }

  it('celularNequi rechaza lo que no es texto', () => {
    expect(() => celularNequi(3001234567)).toThrow('10 dígitos');
    expect(celularNequi('+57 300-123-4567')).toBe('3001234567');
  });

  it('cuenta intentos desde cero y guarda un mensaje genérico si la pasarela falla sin explicación', async () => {
    const t = armar({ ...pasarelaFalsa(), solicitarCobro: async () => Promise.reject(new Error('')) });
    const e = envio({ id_envio: 1, tarifa: 9000 });
    await t.repo.create({ id_envio: 1, metodo: 'nequi', estado: 'pendiente', monto: 9000 });
    const p = await t.servicio.cobrarNequi(e, { id_envio: 1, metodo: 'nequi', estado: 'pendiente', monto: 9000 }, '3001234567');
    expect(p).toMatchObject({ estado: 'rechazado', mensaje: 'Nequi no pudo procesar el cobro', intentos: 1 });
    const ok = armar();
    await ok.repo.create({ id_envio: 1, metodo: 'nequi', estado: 'pendiente', monto: 9000 });
    expect((await ok.servicio.cobrarNequi(e, { id_envio: 1, metodo: 'nequi', estado: 'pendiente', monto: 9000 }, '3001234567')).intentos).toBe(1);
  });

  it('actualizar: usa la fecha de creación o la actual, y no hace nada si el envío ya no existe', async () => {
    const t = armar();
    const sinFechas = { id_envio: 99, metodo: 'nequi' as const, estado: 'pendiente' as const, monto: 1, transaccion_id: 'T' };
    expect(await t.servicio.actualizar(sinFechas)).toBe(sinFechas);
    const conCreado = { ...sinFechas, creado: new Date() };
    expect(await t.servicio.actualizar(conCreado)).toBe(conCreado);
  });

  it('al cancelar un pago ya cobrado lo deja como está', async () => {
    const t = armar();
    await t.repo.create({ id_envio: 1, metodo: 'efectivo', estado: 'cobrado', monto: 5000 });
    expect((await t.servicio.alCancelar(1))?.estado).toBe('cobrado');
  });

  it('reembolso sin teléfono ni transacción y con un fallo sin explicación', async () => {
    const t = armar({ ...pasarelaFalsa(), reembolsar: async () => Promise.reject(new Error('')) });
    await t.repo.create({ id_envio: 1, metodo: 'nequi', estado: 'aprobado', monto: 5000 });
    const p = await t.servicio.reembolsar({ id_envio: 1, metodo: 'nequi', estado: 'aprobado', monto: 5000 });
    expect(p).toMatchObject({ estado: 'reembolso_pendiente', mensaje: 'Reembolso pendiente: Nequi no respondió' });
    const ok = armar();
    await ok.repo.create({ id_envio: 1, metodo: 'nequi', estado: 'aprobado', monto: 5000 });
    expect((await ok.servicio.reembolsar({ id_envio: 1, metodo: 'nequi', estado: 'aprobado', monto: 5000 })).estado).toBe('reembolsado');
  });

  it('el publicador avisa un programado aunque marcarlo falle; un cobro reciente sigue pendiente', async () => {
    const t = armar();
    const publicador = new PublicadorEnvios(
      { ...t.envios, markScheduledAnnounced: async () => Promise.reject(new Error('bd')) } as never,
      { usuariosDisponibles: async () => [7] } as never,
      notificacionesFalsas().servicio,
      AHORA,
    );
    const pronto = new Date(Date.now() + 60_000);
    await expect(publicador.publicar(envio({ fecha_programada: pronto }), null)).resolves.toBeUndefined();
    expect(publicador.visible(envio({ fecha_programada: new Date(Date.now() + 864e5) }), null)).toBe(false);
    const s = new PagosService(new FakePagos(), pasarelaFalsa('pendiente'), new FakeShipments(), publicador, notificacionesFalsas().servicio, AHORA);
    const reciente = { id_envio: 1, metodo: 'nequi' as const, estado: 'pendiente' as const, monto: 1, transaccion_id: 'T', actualizado: new Date() };
    expect(await s.actualizar(reciente)).toBe(reciente);
  });
});
