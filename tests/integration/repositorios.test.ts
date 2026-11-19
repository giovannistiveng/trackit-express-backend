import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { pool } from '../../src/config/database';
import { enTransaccion, filasAfectadas } from '../../src/infrastructure/database/pg-utils';
import { ShipmentRepositoryPostgres } from '../../src/infrastructure/database/repositories/shipment.repository.postgres';
import { DriverRepositoryPostgres } from '../../src/infrastructure/database/repositories/driver.repository.postgres';
import { DocumentoConductorRepositoryPostgres } from '../../src/infrastructure/database/repositories/documento-conductor.repository.postgres';
import { ZonaTarifaRepositoryPostgres } from '../../src/infrastructure/database/repositories/zona-tarifa.repository.postgres';
import { VehicleRepositoryPostgres } from '../../src/infrastructure/database/repositories/vehicle.repository.postgres';
import { MetricsRepositoryPostgres } from '../../src/infrastructure/database/repositories/metrics.repository.postgres';
import { UserRepositoryPostgres } from '../../src/infrastructure/database/repositories/user.repository.postgres';
import { TarifaVehiculoRepositoryPostgres } from '../../src/infrastructure/database/repositories/tarifa-vehiculo.repository.postgres';
import { LiquidacionRepositoryPostgres, PagoRepositoryPostgres } from '../../src/infrastructure/database/repositories/platform.repositories.postgres';
import { ValidationError } from '../../src/shared/errors';
import { hayBaseDeDatos, reiniciarBase } from '../helpers/app';

let disponible = false;
const envios = new ShipmentRepositoryPostgres(pool);
const conductores = new DriverRepositoryPostgres(pool);
const documentos = new DocumentoConductorRepositoryPostgres(pool);
const zonas = new ZonaTarifaRepositoryPostgres(pool);
const vehiculos = new VehicleRepositoryPostgres(pool);
const metricas = new MetricsRepositoryPostgres(pool);
const usuarios = new UserRepositoryPostgres(pool);
const tarifas = new TarifaVehiculoRepositoryPostgres(pool);
const pagos = new PagoRepositoryPostgres(pool);
const liquidaciones = new LiquidacionRepositoryPostgres(pool);
const AHORA = new Date('2026-11-18T17:00:00Z');

let idCliente = 0;
let idConductor = 0;

beforeAll(async () => {
  disponible = await hayBaseDeDatos();
  if (!disponible) return;
  await reiniciarBase();
  idCliente = (await usuarios.create({ nombre: 'Ana Ruiz', correo: 'ana.repo@t.co', password_hash: 'h', id_rol: 2 })).id as number;
  const u = await usuarios.create({ nombre: 'Camilo Rojas', correo: 'camilo.repo@t.co', password_hash: 'h', id_rol: 3 });
  idConductor = (await conductores.findByUserId(u.id as number))?.id_conductor as number;
});

afterAll(async () => {
  await pool.end();
});

const conBd = (nombre: string, fn: () => Promise<void>) =>
  it(nombre, async () => {
    if (!disponible) return expect(disponible).toBe(false);
    await fn();
  });

const minimo = () => ({ origen: 'Casa', destino: 'Finca', tipo_carga: 'Documentos', tarifa: 9000, pin_seguridad: '1234', id_cliente: idCliente, id_zona: 1 });

describe('utilidades de PostgreSQL', () => {
  conBd('enTransaccion hace ROLLBACK y relanza; filasAfectadas trata null como 0', async () => {
    await expect(
      enTransaccion(pool, async (c) => {
        await c.query(`INSERT INTO Contacto (nombre, correo, asunto, mensaje) VALUES ('X', 'x@t.co', 'General', 'mensaje de prueba')`);
        await c.query('SELECT * FROM tabla_que_no_existe');
      }),
    ).rejects.toThrow();
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM Contacto WHERE correo = 'x@t.co'`)).rows[0].n).toBe(0);
    expect(filasAfectadas({ rowCount: null })).toBe(0);
  });

  conBd('métricas con la base vacía: sin ingresos ni calificaciones', async () => {
    const m = await metricas.dashboard();
    expect(m).toMatchObject({ ingresosCop: 0, calificacionPromedio: 0 });
    expect((await metricas.publicas()).calificacionPromedio).toBe(0);
    const resumen = await envios.driverSummary(idConductor);
    expect(resumen).toMatchObject({ completados: 0, ingresos_total: 0, calificacion_promedio: null });
  });
});

describe('envíos', () => {
  conBd('crear sin datos opcionales usa los valores por defecto y lee nulls', async () => {
    const e = await envios.create(minimo());
    expect(e).toMatchObject({ metodo_pago: 'efectivo', ida_y_vuelta: false, tipo_servicio: 'paquete', origen_coords: null, desglose: null, detalle_servicio: null });
    const leido = await envios.findById(e.id_envio as number);
    expect(leido).toMatchObject({ distancia_km: null, valor_compra: null, categoria: null });
    expect(await envios.findById(999_999)).toBeNull();
    expect(await envios.findByToken('no-existe')).toBeNull();
    // Lista sin filtro de estados, para cliente y conductor
    expect((await envios.findByClient(idCliente)).length).toBeGreaterThan(0);
    expect(await envios.findByDriver(idConductor)).toEqual([]);
  });

  conBd('un envío sin PIN se lee sin PIN', async () => {
    const e = await envios.create({ ...minimo(), pin_seguridad: undefined });
    expect((await envios.findById(e.id_envio as number))?.pin_seguridad).toBeUndefined();
  });

  conBd('crear con una zona inexistente deshace la transacción', async () => {
    await expect(envios.create({ ...minimo(), id_zona: 999 })).rejects.toThrow();
  });

  conBd('detalles editables: solo los presentes y nada si no hay cambios', async () => {
    const e = await envios.create(minimo());
    const id = e.id_envio as number;
    await envios.updateDetalles(id, {});
    await envios.updateDetalles(id, { notas: 'Portón azul' });
    expect(await envios.findById(id)).toMatchObject({ notas: 'Portón azul', tipo_carga: 'Documentos' });
  });

  conBd('asignar dos veces, entregar dos veces y calificar dos veces fallan con un mensaje claro', async () => {
    const e = await envios.create(minimo());
    const id = e.id_envio as number;
    await envios.updateStatus(id, 'Asignado', idConductor);
    await expect(envios.updateStatus(id, 'Asignado', idConductor)).rejects.toThrow('ya fue tomado por otro conductor');
    await envios.registerPickup(id, 'https://x/r.jpg', AHORA, {});
    expect(await envios.findById(id)).toMatchObject({ bultos_recogidos: null, valor_compra: null });
    await envios.registerDelivery(id, 'https://x/e.jpg');
    await expect(envios.registerDelivery(id, 'https://x/e.jpg')).rejects.toThrow('ya tiene una evidencia');
    await envios.saveCalification(id, 5, null);
    await expect(envios.saveCalification(id, 4, null)).rejects.toThrow('ya fue calificado');
    await expect(envios.saveCalification(999_999, 4, null)).rejects.toThrow();
    await expect(envios.registerDelivery(999_999, 'https://x/e.jpg')).rejects.not.toBeInstanceOf(ValidationError);
    await expect(envios.cancel(id, null)).rejects.toThrow('ya está entregado');
    // Un envío que no existe no tiene historial: falla al registrar la cancelación
    await expect(envios.cancel(999_999, null)).rejects.toThrow();
  });

  conBd('búsqueda del administrador sin resultados', async () => {
    expect(await envios.searchAdmin({ pagina: 1, tamano: 10, texto: 'nadie-busca-esto' })).toEqual({ items: [], total: 0 });
  });
});

describe('conductores, documentos y vehículos', () => {
  conBd('perfil de conductor creado al vuelo, sin conductor y sin calificaciones', async () => {
    const u = await usuarios.create({ nombre: 'Luz', correo: 'luz.repo@t.co', password_hash: 'h', id_rol: 2 });
    const c = await conductores.ensureForUser(u.id as number);
    expect(c.estado_aprobacion).toBe('Pendiente');
    expect(await conductores.findById(999_999)).toBeNull();
    expect(await conductores.findByUserId(999_999)).toBeNull();
  });

  conBd('documentos vigilados, aviso de vencimiento y documento inexistente', async () => {
    const d = await documentos.create({ tipo_documento: 'SOAT', url_archivo: 'u', id_conductor: idConductor, fecha_vencimiento: new Date('2027-01-10T00:00:00Z') });
    await documentos.review(d.id as number, { estado: 'Aprobado', motivo_rechazo: null, revisado_en: AHORA });
    await conductores.updateApprovalStatus(idConductor, 'Aprobado', null);
    const vigilados = await documentos.findVigilados();
    expect(vigilados.map((v) => v.id)).toContain(d.id);
    await documentos.markWarned(d.id as number, AHORA);
    expect((await documentos.findById(d.id as number))?.aviso_vencimiento_en).toEqual(AHORA);
    expect(await documentos.findById(999_999)).toBeNull();
  });

  conBd('una placa repetida se informa y otros errores se propagan', async () => {
    await vehiculos.create({ placa: 'REP12A', categoria: 'Furgoneta', id_conductor: idConductor });
    await expect(vehiculos.create({ placa: 'REP12A', categoria: 'Furgoneta', id_conductor: idConductor })).rejects.toThrow('La placa ya está registrada');
    await expect(vehiculos.create({ placa: 'OTR12A', categoria: 'Furgoneta', id_conductor: 999_999 })).rejects.not.toBeInstanceOf(ValidationError);
  });
});

describe('zonas y tarifas', () => {
  conBd('crear con valores por defecto, actualizar sin cambios, actualizar y borrar lo que no existe', async () => {
    const z = await zonas.create({ nombre_zona: 'Vereda Prueba', tarifa_base: 0 });
    expect(z).toMatchObject({ radio_km: 3, activa: true, centro: null, descripcion: null });
    expect(await zonas.update(z.id_zona as number, {})).toMatchObject({ nombre_zona: 'Vereda Prueba' });
    expect(await zonas.updateTarifa(z.id_zona as number, 1500)).toMatchObject({ tarifa_base: 1500 });
    expect(await zonas.update(z.id_zona as number, { centro: null })).toMatchObject({ centro: null });
    expect(await zonas.update(999_999, { tarifa_base: 1 })).toBeNull();
    await expect(zonas.update(z.id_zona as number, { nombre_zona: 'Casco Urbano' })).rejects.toThrow('Ya existe una zona con ese nombre');
    await expect(zonas.update(z.id_zona as number, { radio_km: 500 })).rejects.not.toBeInstanceOf(ValidationError);
    await expect(zonas.create({ nombre_zona: 'Lejos', tarifa_base: 0, radio_km: 500 })).rejects.not.toBeInstanceOf(ValidationError);
    expect(await zonas.remove(999_999)).toBeNull();
    // Una zona con envíos se archiva una sola vez
    expect(await zonas.remove(1)).toBe('archivada');
    expect(await zonas.remove(1)).toBeNull();
    expect(await tarifas.update('Moto Express', { banderazo: 1, por_km: 1, por_minuto: 1, minimo: 1 })).toMatchObject({ banderazo: 1 });
  });
});

describe('pagos y liquidaciones', () => {
  conBd('pago sin datos opcionales, sin cambios y de un envío que no existe', async () => {
    const e = await envios.create(minimo());
    const p = await pagos.create({ id_envio: e.id_envio as number, metodo: 'efectivo', estado: 'por_cobrar', monto: 9000 });
    expect(p).toMatchObject({ telefono: null, intentos: 0 });
    expect(await pagos.findByEnvio(999_999)).toBeNull();
    expect(await pagos.update(999_999, { estado: 'cobrado' })).toBeNull();
    expect((await pagos.update(e.id_envio as number, { telefono: undefined }))?.telefono).toBeNull();
    expect((await pagos.search({ pagina: 1, tamano: 5, estado: 'reembolsado' })).total).toBe(0);
  });

  conBd('generar dos veces el mismo periodo no duplica; marcar pagada lo que no existe', async () => {
    expect(await liquidaciones.generar('2026-01-01', '2026-12-31')).toEqual(expect.any(Array));
    expect(await liquidaciones.generar('2026-01-01', '2026-12-31')).toEqual([]);
    expect(await liquidaciones.marcarPagada(999_999, 'ref', AHORA)).toBeNull();
  });
});

describe('lecturas con datos opcionales ausentes', () => {
  conBd('usuario inexistente, búsqueda con resultados y estadísticas con calificaciones', async () => {
    expect(await usuarios.findById(999_999)).toBeNull();
    const r = await envios.searchAdmin({ pagina: 1, tamano: 5 });
    expect(r.total).toBeGreaterThan(0);
    expect((await metricas.publicas()).calificacionPromedio).toBeGreaterThan(0);
  });

  conBd('un envío sin historial y con un conductor sin vehículo se lee con nulos', async () => {
    const u = await usuarios.create({ nombre: 'Sin Vehículo', correo: 'sinvehiculo.repo@t.co', password_hash: 'h', id_rol: 3 });
    const sinVehiculo = (await conductores.findByUserId(u.id as number))?.id_conductor as number;
    const e = await envios.create(minimo());
    const id = e.id_envio as number;
    await envios.updateStatus(id, 'Asignado', sinVehiculo);
    await pool.query('DELETE FROM Historial_Estado WHERE id_envio = $1', [id]);
    const leido = (await envios.findByClient(idCliente)).find((x) => x.id_envio === id);
    expect(leido).toMatchObject({ estado: 'Pendiente', fecha_ultimo_cambio: undefined, conductor: { placa: null, vehiculo: null } });
    const buscado = (await envios.searchAdmin({ pagina: 1, tamano: 5, texto: String(id) })).items.find((x) => x.id_envio === id);
    expect(buscado?.fecha_ultimo_cambio).toBeUndefined();
  });

  conBd('si la liquidación de la semana ya existe, las entregas nuevas esperan a la siguiente', async () => {
    const entregar = async () => {
      const e = await envios.create(minimo());
      const id = e.id_envio as number;
      await envios.updateStatus(id, 'Asignado', idConductor);
      await envios.updateStatus(id, 'Entregado');
      await pagos.create({ id_envio: id, metodo: 'efectivo', estado: 'cobrado', monto: 9000 });
    };
    await entregar();
    expect((await liquidaciones.generar('2026-01-01', '2099-12-31')).length).toBeGreaterThan(0);
    await entregar();
    expect(await liquidaciones.generar('2026-01-01', '2099-12-31')).toEqual([]);
  });
});
