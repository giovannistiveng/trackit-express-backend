import { Cotizador, TARIFAS_POR_DEFECTO } from '../../src/application/services/cotizador';
import {
  CreateZoneUseCase,
  ListZonesAdminUseCase,
  UpdateVehicleTariffUseCase,
  UpdateZoneUseCase,
} from '../../src/application/use-cases/admin/admin.use-cases';
import { ListVehicleTariffsUseCase, ReverseGeocodeUseCase, SearchAddressUseCase } from '../../src/application/use-cases/catalog/catalog.use-cases';
import { ZonaTarifa } from '../../src/domain/entities/zona-tarifa.entity';
import { DistancePort } from '../../src/domain/ports/services.port';
import { ZonaTarifaRepositoryPort } from '../../src/domain/ports/zona-tarifa.repository.port';
import {
  calcularTarifaDetallada,
  categoriasAtendibles,
  esNocturno,
  horaColombia,
  puedeAtender,
  vehiculosQuePuedenLlevar,
  zonaDelPunto,
} from '../../src/domain/services/tarifas';
import { AuditService } from '../../src/application/services/audit.service';
import { ForbiddenError, NotFoundError, ValidationError } from '../../src/shared/errors';
import { ADMIN, CLIENTE } from '../helpers/fakes';

const MOTO = TARIFAS_POR_DEFECTO[0];
const MEDIODIA = new Date('2026-10-29T17:00:00Z');
const NOCHE = new Date('2026-10-30T02:30:00Z'); // 21:30 en Colombia

describe('reglas de tarifa', () => {
  it('suma banderazo, km y minutos, redondea a 100 hacia arriba', () => {
    const d = calcularTarifaDetallada({ tarifa: MOTO, distanciaKm: 3.2, minutos: 9, recargoZona: 0, fecha: MEDIODIA });
    // 2.000 + 2.240 + 450 = 4.690 → 4.700
    expect(d).toEqual({ categoria: 'Moto Express', banderazo: 2000, distancia: 2240, tiempo: 450, recargo_zona: 0, paradas: 0, recargo_paradas: 0, ida_y_vuelta: false, recargo_nocturno: 0, minimo_aplicado: false, total: 4700 });
  });

  it('aplica la tarifa mínima en viajes cortos y el recargo nocturno del 20 %', () => {
    const corto = calcularTarifaDetallada({ tarifa: MOTO, distanciaKm: 0.5, minutos: 2, recargoZona: 0, fecha: MEDIODIA });
    expect(corto).toMatchObject({ minimo_aplicado: true, total: 4500 });
    const noche = calcularTarifaDetallada({ tarifa: MOTO, distanciaKm: 0.5, minutos: 2, recargoZona: 2000, fecha: NOCHE });
    expect(noche).toMatchObject({ recargo_zona: 2000, recargo_nocturno: 1300, total: 7800 });
    expect(calcularTarifaDetallada({ tarifa: MOTO, distanciaKm: -1, minutos: -1, recargoZona: -5 }).distancia).toBe(0);
  });

  it('calcula la hora de Colombia y el horario nocturno', () => {
    expect(horaColombia(MEDIODIA)).toBe(12);
    expect(horaColombia(new Date('2026-10-29T03:00:00Z'))).toBe(22);
    expect(esNocturno(NOCHE)).toBe(true);
    expect(esNocturno(new Date('2026-10-29T10:59:00Z'))).toBe(true); // 5:59
    expect(esNocturno(new Date('2026-10-29T11:00:00Z'))).toBe(false); // 6:00
  });

  it('un vehículo grande atiende pedidos de su tamaño o menores', () => {
    expect(categoriasAtendibles([])).toEqual([]);
    expect(categoriasAtendibles(['Moto Express'])).toEqual(['Moto Express']);
    expect(categoriasAtendibles(['Moto Express', 'Camioneta'])).toEqual(['Moto Express', 'Motocarro', 'Camioneta']);
    expect(puedeAtender(['Motocarro'], null)).toBe(true);
    expect(puedeAtender(['Motocarro'], 'Camioneta')).toBe(false);
    expect(vehiculosQuePuedenLlevar('Motocarro')).toEqual(['Motocarro', 'Camioneta']);
    expect(vehiculosQuePuedenLlevar(null)).toHaveLength(3);
  });

  it('elige la zona activa más pequeña que contiene el punto', () => {
    const zonas: ZonaTarifa[] = [
      { id_zona: 1, nombre_zona: 'Rural', tarifa_base: 2500, centro: { lat: 4.3365, lon: -74.3638 }, radio_km: 12 },
      { id_zona: 2, nombre_zona: 'Centro', tarifa_base: 0, centro: { lat: 4.3365, lon: -74.3638 }, radio_km: 3 },
      { id_zona: 3, nombre_zona: 'Apagada', tarifa_base: 0, centro: { lat: 4.3365, lon: -74.3638 }, radio_km: 1, activa: false },
      { id_zona: 4, nombre_zona: 'Sin centro', tarifa_base: 0, centro: null },
    ];
    expect(zonaDelPunto(zonas, { lat: 4.337, lon: -74.364 })?.nombre_zona).toBe('Centro');
    expect(zonaDelPunto(zonas, { lat: 4.4, lon: -74.36 })?.nombre_zona).toBe('Rural');
    expect(zonaDelPunto(zonas, { lat: 4.711, lon: -74.07 })).toBeNull();
  });
});

function zonasFalsas(lista: ZonaTarifa[]): ZonaTarifaRepositoryPort & { lista: ZonaTarifa[] } {
  return {
    lista,
    findById: async (id) => lista.find((z) => z.id_zona === id) ?? null,
    findAll: async (todas) => lista.filter((z) => todas || z.activa !== false),
    updateTarifa: async () => null,
    create: async (z) => {
      const n = { ...z, id_zona: lista.length + 1 };
      lista.push(n);
      return n;
    },
    update: async (id, c) => {
      const z = lista.find((x) => x.id_zona === id);
      return z ? Object.assign(z, c) : null;
    },
    remove: async (id) => {
      const i = lista.findIndex((x) => x.id_zona === id);
      if (i < 0) return null;
      lista.splice(i, 1);
      return 'borrada';
    },
  };
}

describe('Cotizador', () => {
  const sinCoords: DistancePort = { calcularDistancia: async () => ({ distancia_km: 5, duracion_segundos: 600, origen: null, destino: null, exacta: false }) };
  const zonas = zonasFalsas([
    { id_zona: 1, nombre_zona: 'Centro', tarifa_base: 0, centro: { lat: 4.3365, lon: -74.3638 }, radio_km: 3 },
    { id_zona: 2, nombre_zona: 'Vereda', tarifa_base: 2000, centro: null },
    { id_zona: 3, nombre_zona: 'Cerrada', tarifa_base: 0, centro: null, activa: false },
  ]);

  it('sin coordenadas usa la zona elegida a mano y las tarifas por defecto si la tabla falla', async () => {
    const tarifasRotas = { findAll: async () => Promise.reject(new Error('no existe la tabla')), update: async () => null };
    const c = new Cotizador(zonas, tarifasRotas, sinCoords, () => MEDIODIA);
    const r = await c.cotizar({ origen: 'Centro', destino: 'Finca', id_zona: 2, categoria: 'Motocarro' });
    expect(r.zona.nombre_zona).toBe('Vereda');
    expect(r.zonaOrigen).toBeNull();
    // 5 km y 10 min en Motocarro: 4.000 + 4.750 + 800 = 9.550 + 2.000 → 11.600
    expect(r.desglose.total).toBe(11600);
    await expect(c.cotizar({ origen: 'Centro', destino: 'Finca' })).rejects.toThrow('Elígela en el mapa o selecciona la zona');
    await expect(c.cotizar({ origen: 'Centro', destino: 'Finca', id_zona: 3 })).rejects.toThrow(NotFoundError);
    await expect(c.cotizar({ origen: 'Centro', destino: 'Finca', origen_coords: { lat: 'x', lon: 1 } })).rejects.toThrow(ValidationError);
    await expect(c.cotizar({ origen: 'Centro', destino: 'Finca', destino_coords: 'abc' })).rejects.toThrow(ValidationError);
  });

  it('rechaza origen y destino en el mismo punto; usa tarifas por defecto si la tabla está vacía', async () => {
    const mismo: DistancePort = { calcularDistancia: async () => ({ distancia_km: 0.01, duracion_segundos: 10, origen: { lat: 4.3365, lon: -74.3638 }, destino: { lat: 4.3365, lon: -74.3638 }, exacta: true }) };
    const c = new Cotizador(zonas, { findAll: async () => [], update: async () => null }, mismo);
    await expect(c.cotizar({ origen: 'Aquí', destino: 'Allí' })).rejects.toThrow('mismo lugar');
  });
});

describe('casos de uso de zonas, tarifas y direcciones', () => {
  const audit = new AuditService({ save: async () => undefined } as never);

  it('crea, lista y edita zonas solo como administrador', async () => {
    const repo = zonasFalsas([]);
    await expect(new ListZonesAdminUseCase(repo).execute(CLIENTE)).rejects.toThrow(ForbiddenError);
    const z = await new CreateZoneUseCase(repo, audit).execute(ADMIN, { nombre_zona: 'Chinauta', centro: { lat: 4.27, lon: -74.41 } });
    expect(z).toMatchObject({ recargo: 0, radio_km: 3, activa: true });
    await expect(new CreateZoneUseCase(repo, audit).execute(ADMIN, { nombre_zona: 'Otra', centro: { lat: 4, lon: -74 }, recargo: 999999 })).rejects.toThrow('200.000');
    const e = await new UpdateZoneUseCase(repo, audit).execute(ADMIN, 1, { recargo: 1500, descripcion: '  ' });
    expect(e).toMatchObject({ recargo: 1500, descripcion: null });
    await expect(new UpdateZoneUseCase(repo, audit).execute(ADMIN, 9, { recargo: 1 })).rejects.toThrow(NotFoundError);
    expect(await new ListZonesAdminUseCase(repo).execute(ADMIN)).toHaveLength(1);
  });

  it('actualiza tarifas de vehículo y las lista con las reglas de recargo', async () => {
    const guardadas: unknown[] = [];
    const repo = { findAll: async () => [], update: async (c: string, t: object) => (guardadas.push(t), { categoria: c, ...t }) };
    await expect(new UpdateVehicleTariffUseCase(repo as never, audit).execute(ADMIN, '', {})).rejects.toThrow('Indica la categoría');
    const t = await new UpdateVehicleTariffUseCase(repo as never, audit).execute(ADMIN, 'Camioneta', { banderazo: '10000.4', por_km: 1800, por_minuto: 150, minimo: 20000 });
    expect(t).toEqual({ categoria: 'Camioneta', banderazo: 10000, por_km: 1800, por_minuto: 150, minimo: 20000 });
    const lista = await new ListVehicleTariffsUseCase(repo as never).execute();
    expect(lista.tarifas).toBe(TARIFAS_POR_DEFECTO);
    const rota = await new ListVehicleTariffsUseCase({ findAll: () => Promise.reject(new Error('x')) } as never).execute();
    expect(rota.tarifas).toHaveLength(3);
  });

  it('busca direcciones y valida coordenadas', async () => {
    const geo = { buscar: jest.fn(async () => []), inversa: jest.fn(async () => null) };
    expect(await new SearchAddressUseCase(geo).execute(undefined)).toEqual([]);
    expect(await new SearchAddressUseCase(geo).execute(' ca ')).toEqual([]);
    await new SearchAddressUseCase(geo).execute('Carrera 6');
    expect(geo.buscar).toHaveBeenCalledWith('Carrera 6');
    await expect(new SearchAddressUseCase(geo).execute('x'.repeat(130))).rejects.toThrow(ValidationError);
    await new ReverseGeocodeUseCase(geo).execute('4.33', '-74.36');
    expect(geo.inversa).toHaveBeenCalledWith({ lat: 4.33, lon: -74.36 });
    await expect(new ReverseGeocodeUseCase(geo).execute('abc', '1')).rejects.toThrow(ValidationError);
  });
});
