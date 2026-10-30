import { NotificationService } from '../../src/application/services/notification.service';
import { textoOpcional, telefonoOpcional } from '../../src/application/validation';
import { GetTrackingUseCase } from '../../src/application/use-cases/shipments/driver-shipments.use-cases';
import { CancelShipmentUseCase } from '../../src/application/use-cases/shipments/client-shipments.use-cases';
import { GetPublicStatsUseCase } from '../../src/application/use-cases/public/public.use-cases';
import { gananciaConductor } from '../../src/domain/entities/shipment.entity';
import { coordenadasValidas, haversineKm, minutosEstimados } from '../../src/domain/services/geo';
import { ValidationError } from '../../src/shared/errors';
import { ADMIN, CLIENTE, CONDUCTOR, FakeDrivers, FakeShipments, auditFalso, conductorAprobado, envio, notificacionesFalsas } from '../helpers/fakes';

const FUSA = { lat: 4.3369, lon: -74.3638 };
const SILVANIA = { lat: 4.4033, lon: -74.3878 };

describe('geografía', () => {
  it('haversine entre Fusagasugá y Silvania ronda 7,8 km en línea recta', () => {
    expect(haversineKm(FUSA, SILVANIA)).toBeCloseTo(7.85, 1);
    expect(haversineKm(FUSA, FUSA)).toBe(0);
  });
  it('minutos estimados con factor de vía y mínimo de 1', () => {
    expect(minutosEstimados(0)).toBe(1);
    expect(minutosEstimados(10)).toBe(26);
    expect(minutosEstimados(10, 60)).toBe(13);
  });
  it('valida coordenadas', () => {
    expect(coordenadasValidas(FUSA)).toBe(true);
    expect(coordenadasValidas({ lat: 95, lon: 0 })).toBe(false);
    expect(coordenadasValidas(null)).toBe(false);
    expect(coordenadasValidas({ lat: Number.NaN, lon: 0 })).toBe(false);
  });
  it('la ganancia del conductor es el 80 % redondeado', () => {
    expect(gananciaConductor(39500)).toBe(31600);
    expect(gananciaConductor(1001)).toBe(801);
  });
});

describe('validación de textos opcionales', () => {
  it('textoOpcional', () => {
    expect(textoOpcional(undefined, 'x', 5)).toBeNull();
    expect(textoOpcional('   ', 'x', 5)).toBeNull();
    expect(textoOpcional(' a  b ', 'x', 5)).toBe('a b');
    expect(() => textoOpcional(5, 'x', 5)).toThrow('debe ser texto');
    expect(() => textoOpcional('abcdef', 'x', 5)).toThrow('máximo 5');
  });
  it('telefonoOpcional', () => {
    expect(telefonoOpcional('')).toBeNull();
    expect(telefonoOpcional('+57 310-555-1234')).toBe('+573105551234');
    expect(() => telefonoOpcional('abc1234')).toThrow(ValidationError);
  });
});

describe('NotificationService', () => {
  it('recorta textos largos y nunca lanza si falla el repositorio', async () => {
    const { repo, servicio } = notificacionesFalsas();
    await servicio.notificar({ id_usuario: 1, tipo: 'envio_aceptado', titulo: 't'.repeat(200), mensaje: 'm'.repeat(400) });
    expect(repo.avisos[0].titulo).toHaveLength(120);
    expect(repo.avisos[0].mensaje).toHaveLength(300);
    const alFallar = jest.fn();
    const roto = new NotificationService({ ...repo, save: async () => Promise.reject(new Error('bd caída')) } as never, alFallar);
    await expect(roto.notificar({ id_usuario: 1, tipo: 'envio_aceptado', titulo: 't', mensaje: 'm' })).resolves.toBeUndefined();
    expect(alFallar).toHaveBeenCalled();
  });
});

describe('GetTrackingUseCase', () => {
  const ubicacion = (lat: number, lon: number, hace: number, ahora: Date) => ({ id_envio: 1, lat, lon, capturado_en: new Date(ahora.getTime() - hace) });

  it('en Asignado suma el trayecto hasta recoger y luego al destino; marca señal vieja como no en vivo', async () => {
    const ahora = new Date('2026-10-29T15:00:00Z');
    const s = new FakeShipments();
    const d = new FakeDrivers();
    conductorAprobado(d, 5);
    s.envios.set(1, envio({ estado: 'Asignado', id_conductor: 5, origen_coords: FUSA, destino_coords: SILVANIA }));
    const trail = [ubicacion(4.30, -74.36, 10 * 60_000, ahora)];
    const uc = new GetTrackingUseCase(s, d, { save: jest.fn(), findLast: jest.fn(), findTrail: async () => trail }, () => ahora);
    const r = await uc.execute(CLIENTE, 1);
    const hastaOrigen = haversineKm(trail[0], FUSA);
    expect(r.distancia_restante_km).toBeCloseTo(hastaOrigen + haversineKm(FUSA, SILVANIA), 0);
    expect(r.en_vivo).toBe(false);
    expect(r.eta_minutos).toBe(minutosEstimados(r.distancia_restante_km as number));
  });

  it('sin coordenadas del destino no calcula ETA', async () => {
    const ahora = new Date();
    const s = new FakeShipments();
    const d = new FakeDrivers();
    conductorAprobado(d, 5);
    s.envios.set(1, envio({ estado: 'En Ruta', id_conductor: 5 }));
    const uc = new GetTrackingUseCase(s, d, { save: jest.fn(), findLast: jest.fn(), findTrail: async () => [ubicacion(4.3, -74.3, 1000, ahora)] }, () => ahora);
    const r = await uc.execute(CONDUCTOR, 1);
    expect(r).toMatchObject({ en_vivo: true, eta_minutos: null, distancia_restante_km: null });
  });
});

describe('CancelShipmentUseCase', () => {
  it('el administrador cancela En Ruta y avisa al cliente y al conductor', async () => {
    const s = new FakeShipments();
    const d = new FakeDrivers();
    conductorAprobado(d, 5);
    s.envios.set(1, envio({ estado: 'En Ruta', id_conductor: 5 }));
    const { repo, servicio } = notificacionesFalsas();
    const r = await new CancelShipmentUseCase(s, d, auditFalso().audit, servicio).execute(ADMIN, 1, 'Vía cerrada');
    expect(r.estado).toBe('Cancelado');
    expect(repo.avisos.map((a) => a.id_usuario).sort()).toEqual([CLIENTE.userId, CONDUCTOR.userId].sort());
    await expect(new CancelShipmentUseCase(s, d, auditFalso().audit, servicio).execute(CONDUCTOR, 1)).rejects.toThrow();
  });
});

describe('GetPublicStatsUseCase', () => {
  it('guarda las cifras un minuto', async () => {
    let t = 0;
    const publicas = jest.fn(async () => ({ enviosEntregados: 1, conductoresActivos: 1, zonasCubiertas: 5, calificacionPromedio: 5 }));
    const uc = new GetPublicStatsUseCase({ dashboard: jest.fn(), publicas }, () => t);
    await uc.execute();
    t = 59_000;
    await uc.execute();
    expect(publicas).toHaveBeenCalledTimes(1);
    t = 61_000;
    await uc.execute();
    expect(publicas).toHaveBeenCalledTimes(2);
  });
});
