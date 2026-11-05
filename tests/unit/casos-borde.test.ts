import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  GenerateSettlementsUseCase,
  GetShipmentPaymentUseCase,
  ListPaymentsAdminUseCase,
  ListSettlementsUseCase,
  PaySettlementUseCase,
  RetryNequiPaymentUseCase,
  SwitchToCashUseCase,
} from '../../src/application/use-cases/payments/payment.use-cases';
import { ListChatUseCase, SendChatMessageUseCase, sinControles } from '../../src/application/use-cases/shipments/chat.use-cases';
import { Liquidacion, Pago } from '../../src/domain/entities/pago.entity';
import { LiquidacionRepositoryPort } from '../../src/domain/ports/platform.ports';
import { UserRepositoryPort } from '../../src/domain/ports/user.repository.port';
import { patronBusqueda } from '../../src/infrastructure/database/pg-utils';
import { EjecutorSql, Migrador } from '../../src/infrastructure/database/migrador';
import { esCorreo } from '../../src/application/validation';
import { ForbiddenError, NotFoundError, ValidationError } from '../../src/shared/errors';
import {
  ADMIN,
  CLIENTE,
  CONDUCTOR,
  FakeChat,
  FakeDrivers,
  FakeShipments,
  auditFalso,
  conductorAprobado,
  envio,
  notificacionesFalsas,
  pagosFalsos,
} from '../helpers/fakes';

function escenarioPagos(pago: Partial<Pago> = {}) {
  const envios = new FakeShipments();
  const drivers = new FakeDrivers();
  const { servicio: notificaciones, repo: avisos } = notificacionesFalsas();
  const pagos = pagosFalsos(envios, drivers, notificaciones);
  const { audit } = auditFalso();
  envios.envios.set(1, envio({ id_envio: 1, metodo_pago: 'nequi' }));
  pagos.repo.pagos.set(1, {
    id_pago: 1,
    id_envio: 1,
    metodo: 'nequi',
    estado: 'rechazado',
    monto: 1000,
    telefono: '3001234567',
    intentos: 1,
    ...pago,
  });
  return { envios, drivers, pagos, audit, notificaciones, avisos };
}

describe('Pagos: reglas de cada caso de uso', () => {
  it('reintentar con Nequi: solo el dueño, solo Pendiente, ni pagado ni con 5 intentos', async () => {
    const e = escenarioPagos();
    const uc = new RetryNequiPaymentUseCase(e.envios, e.pagos.repo, e.pagos.servicio, e.audit);
    await expect(uc.execute({ ...CLIENTE, userId: 99 }, 1, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(uc.execute(CLIENTE, 1, { telefono: '12' })).rejects.toBeInstanceOf(ValidationError);
    e.pagos.repo.pagos.set(1, { ...(e.pagos.repo.pagos.get(1) as Pago), intentos: 5 });
    await expect(uc.execute(CLIENTE, 1, {})).rejects.toThrow('máximo de intentos');
    e.pagos.repo.pagos.set(1, { ...(e.pagos.repo.pagos.get(1) as Pago), estado: 'aprobado' });
    await expect(uc.execute(CLIENTE, 1, {})).rejects.toThrow('ya está pagado');
    e.envios.envios.set(1, envio({ id_envio: 1, estado: 'Asignado', id_conductor: 5 }));
    await expect(uc.execute(CLIENTE, 1, {})).rejects.toThrow('ya no admite cambios');
  });

  it('pasar a efectivo: si ya es efectivo no cambia nada; si ya pagó con Nequi lo impide', async () => {
    const e = escenarioPagos({ metodo: 'efectivo', estado: 'por_cobrar' });
    const uc = new SwitchToCashUseCase(e.envios, e.pagos.repo, e.pagos.publicador, e.audit);
    expect(await uc.execute(CLIENTE, 1)).toMatchObject({ metodo: 'efectivo', estado: 'por_cobrar' });
    await expect(uc.execute({ ...CLIENTE, userId: 99 }, 1)).rejects.toBeInstanceOf(ForbiddenError);
    e.pagos.repo.pagos.set(1, { ...(e.pagos.repo.pagos.get(1) as Pago), metodo: 'nequi', estado: 'aprobado' });
    await expect(uc.execute(CLIENTE, 1)).rejects.toThrow('ya está pagado con Nequi');
  });

  it('consultar el pago: el admin ve cualquiera; un envío sin pago responde 404', async () => {
    const e = escenarioPagos({ estado: 'aprobado' });
    const uc = new GetShipmentPaymentUseCase(e.envios, e.drivers, e.pagos.repo, e.pagos.servicio);
    expect(await uc.execute(ADMIN, 1)).toMatchObject({ estado: 'aprobado', telefono: '*** *** 4567' });
    e.pagos.repo.pagos.clear();
    await expect(uc.execute(CLIENTE, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listar pagos y liquidaciones normaliza filtros y paginación', async () => {
    const e = escenarioPagos();
    const busqueda = jest.spyOn(e.pagos.repo, 'search');
    await new ListPaymentsAdminUseCase(e.pagos.repo).execute(ADMIN, { metodo: 'x', estado: 'otro', pagina: '-3', tamano: '999' });
    expect(busqueda).toHaveBeenCalledWith({ metodo: undefined, estado: undefined, pagina: 1, tamano: 50 });
    const repo = liquidacionesFalsas([]);
    const r = await new ListSettlementsUseCase(repo).execute(ADMIN, { estado: 'pagada', pagina: '2' });
    expect(r).toMatchObject({ pagina: 2, tamano: 20 });
    expect(repo.list).toHaveBeenCalledWith({ estado: 'pagada', pagina: 2, tamano: 20 });
    await new ListSettlementsUseCase(repo).execute(ADMIN, { estado: 'cualquiera' });
    expect(repo.list).toHaveBeenLastCalledWith({ estado: undefined, pagina: 1, tamano: 20 });
    await expect(new ListSettlementsUseCase(repo).execute(CLIENTE, {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('generar liquidaciones avisa al conductor según el saldo y omite conductores inexistentes', async () => {
    const drivers = new FakeDrivers();
    conductorAprobado(drivers, 5);
    const { servicio, repo: avisos } = notificacionesFalsas();
    const { audit, repo: auditoria } = auditFalso();
    const base = { desde: '2026-10-26', hasta: '2026-11-01', estado: 'pendiente' as const, total_tarifas: 0, ganancia_conductor: 0, cobrado_efectivo: 0, comision_efectivo: 0 };
    const repo = liquidacionesFalsas([
      { ...base, id_liquidacion: 1, id_conductor: 5, servicios: 3, saldo: 12000 },
      { ...base, id_liquidacion: 2, id_conductor: 5, servicios: 2, saldo: -4000 },
      { ...base, id_liquidacion: 3, id_conductor: 5, servicios: 1, saldo: 0 },
      { ...base, id_liquidacion: 4, id_conductor: 77, servicios: 1, saldo: 100 },
    ]);
    const lunes = () => new Date('2026-11-02T15:00:00Z');
    const uc = new GenerateSettlementsUseCase(repo, drivers, servicio, audit, lunes);
    await expect(uc.execute(ADMIN, { hasta: '02/11/2026' })).rejects.toThrow('AAAA-MM-DD');
    await expect(uc.execute(ADMIN, { hasta: '2026-12-01' })).rejects.toThrow('no puede ser futura');
    const creadas = await uc.execute(ADMIN);
    expect(repo.generar).toHaveBeenCalledWith('2026-10-26', '2026-11-01');
    expect(creadas).toHaveLength(4);
    expect(avisos.avisos.map((a) => a.mensaje)).toEqual([
      expect.stringContaining('Te pagaremos $ 12.000'),
      expect.stringContaining('Debes $ 4.000 de comisión'),
      expect.stringContaining('quedaron saldados'),
    ]);
    expect(auditoria.registros).toHaveLength(1);
    // La tarea automática (sin actor) no deja auditoría
    await uc.execute(null);
    expect(auditoria.registros).toHaveLength(1);
  });

  it('registrar el pago de una liquidación: comisión en contra, referencia y estado', async () => {
    const drivers = new FakeDrivers();
    conductorAprobado(drivers, 5);
    const { servicio, repo: avisos } = notificacionesFalsas();
    const { audit } = auditFalso();
    const l: Liquidacion = { id_liquidacion: 9, id_conductor: 5, desde: 'a', hasta: 'b', servicios: 1, total_tarifas: 1, ganancia_conductor: 1, cobrado_efectivo: 1, comision_efectivo: 1, saldo: -3000, estado: 'pendiente' };
    const repo = liquidacionesFalsas([], l);
    const uc = new PaySettlementUseCase(repo, drivers, servicio, audit, () => new Date('2026-11-03T12:00:00Z'));
    await expect(uc.execute(ADMIN, 9, { referencia: 'x' })).rejects.toThrow('referencia');
    await expect(uc.execute(ADMIN, 10, { referencia: 'Nequi 123' })).rejects.toBeInstanceOf(NotFoundError);
    await uc.execute(ADMIN, 9, { referencia: 'Nequi 123' });
    expect(avisos.avisos[0].titulo).toBe('Registramos tu pago de comisión');
    (repo.findById as jest.Mock).mockResolvedValueOnce({ ...l, estado: 'pagada' });
    await expect(uc.execute(ADMIN, 9, { referencia: 'Nequi 123' })).rejects.toThrow('ya está pagada');
  });
});

function liquidacionesFalsas(generadas: Liquidacion[], una?: Liquidacion): jest.Mocked<LiquidacionRepositoryPort> {
  return {
    generar: jest.fn(async () => generadas),
    list: jest.fn(async () => ({ items: generadas, total: generadas.length })),
    findById: jest.fn(async (id: number) => (una && id === una.id_liquidacion ? una : null)),
    marcarPagada: jest.fn(async (id: number, referencia: string, ahora: Date) =>
      una ? { ...una, estado: 'pagada' as const, referencia, pagada_en: ahora } : null,
    ),
    movimientosPendientes: jest.fn(async () => []),
  } as unknown as jest.Mocked<LiquidacionRepositoryPort>;
}

describe('Chat: reglas', () => {
  function escenarioChat(estado: 'Pendiente' | 'Asignado' | 'Entregado' = 'Asignado') {
    const envios = new FakeShipments();
    const drivers = new FakeDrivers();
    conductorAprobado(drivers, 5);
    envios.envios.set(1, envio({ id_envio: 1, estado, id_conductor: 5 }));
    const chat = new FakeChat();
    const { servicio } = notificacionesFalsas();
    const users = { findById: jest.fn(async (id: number) => ({ id_usuario: id, nombre: id === CONDUCTOR.userId ? 'Camilo Rojas' : 'Ana Ruiz' })) } as unknown as UserRepositoryPort;
    const push = jest.spyOn(servicio, 'push').mockRejectedValue(new Error('push caído'));
    return { envios, drivers, chat, servicio, users, push };
  }

  it('el admin solo lee; con el envío cerrado no se escribe; valida el texto', async () => {
    const e = escenarioChat();
    const enviar = new SendChatMessageUseCase(e.envios, e.drivers, e.users, e.chat, e.servicio);
    await expect(enviar.execute(ADMIN, 1, { texto: 'hola' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(enviar.execute(CLIENTE, 1, { texto: '\u0007  ' })).rejects.toThrow('Escribe un mensaje');
    await expect(enviar.execute(CLIENTE, 1, { texto: 'x'.repeat(501) })).rejects.toThrow('máximo 500');
    await expect(enviar.execute(CLIENTE, 1, { texto: 42 })).rejects.toThrow('Escribe un mensaje');
    const lista = await new ListChatUseCase(e.envios, e.drivers, e.chat).execute(ADMIN, 1);
    expect(lista.abierto).toBe(false);
    const cerrado = escenarioChat('Entregado');
    await expect(new SendChatMessageUseCase(cerrado.envios, cerrado.drivers, cerrado.users, cerrado.chat, cerrado.servicio).execute(CLIENTE, 1, { texto: 'hola' })).rejects.toThrow(
      'mientras el envío tiene conductor',
    );
  });

  it('un fallo del push no impide enviar; el conductor firma con su primer nombre', async () => {
    const e = escenarioChat();
    const enviar = new SendChatMessageUseCase(e.envios, e.drivers, e.users, e.chat, e.servicio);
    const m = await enviar.execute(CONDUCTOR, 1, { texto: 'Llegué\u0000 ' });
    expect(m).toMatchObject({ texto: 'Llegué', mio: true, autor: 'Camilo' });
    expect(e.push).toHaveBeenCalledWith(CLIENTE.userId, 'Camilo · envío #1', 'Llegué', '/envios/1?chat=1', 'chat-1');
    await enviar.execute(CLIENTE, 1, { texto: 'Gracias' });
    expect(e.push).toHaveBeenLastCalledWith(CONDUCTOR.userId, 'El cliente · envío #1', 'Gracias', '/envios/1?chat=1', 'chat-1');
  });

  it('sinControles conserva tabuladores y saltos de línea', () => {
    expect(sinControles('a\tb\nc\u0001d\u007fe')).toBe('a\tb\ncde');
  });
});

describe('Utilidades de validación y SQL', () => {
  it.each([
    ['ana@correo.co', true],
    ['ana.ruiz+envios@sub.dominio.com', true],
    ['sin-arroba.co', false],
    ['@correo.co', false],
    ['a@@correo.co', false],
    ['ana@correo', false],
    ['ana@correo.c', false],
    ['ana @correo.co', false],
    [`${'a'.repeat(180)}@c.co`, false],
  ])('esCorreo(%s) = %s', (correo, esperado) => {
    expect(esCorreo(correo)).toBe(esperado);
  });

  it('patronBusqueda escapa los comodines de LIKE', () => {
    expect(patronBusqueda('50%_x\\')).toBe('%50\\%\\_x\\\\%');
  });
});

describe('Migrador', () => {
  function carpeta(migraciones: Record<string, string>) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'migrador-'));
    mkdirSync(path.join(dir, 'migrations'));
    writeFileSync(path.join(dir, 'schema.sql'), '-- esquema');
    writeFileSync(path.join(dir, 'seed.sql'), '-- semilla');
    for (const [n, sql] of Object.entries(migraciones)) writeFileSync(path.join(dir, 'migrations', n), sql);
    writeFileSync(path.join(dir, 'migrations', 'LEEME.txt'), 'no es una migración');
    return dir;
  }

  function bdFalsa(existe: boolean, aplicadas: string[] = []) {
    const sentencias: string[] = [];
    const db: EjecutorSql & { query: jest.Mock } = {
      query: jest.fn(async (sql: string, params?: unknown[]): Promise<{ rows: never[] }> => {
        sentencias.push(params ? `${sql} [${params.join(',')}]` : sql);
        if (sql.includes('to_regclass')) return { rows: [{ existe }] as never[] };
        if (sql.startsWith('SELECT nombre FROM schema_migrations')) return { rows: aplicadas.map((nombre) => ({ nombre })) as never[] };
        return { rows: [] };
      }),
    };
    return { db, sentencias };
  }

  it('preparar una base vacía crea el esquema y marca las migraciones como aplicadas', async () => {
    const dir = carpeta({ '002_b.sql': '-- b', '001_a.sql': '-- a' });
    const { db, sentencias } = bdFalsa(false);
    const log = jest.fn();
    expect(await new Migrador(db, dir, log).preparar()).toBe('creada');
    expect(sentencias).toEqual(
      expect.arrayContaining(['-- esquema', '-- semilla', 'INSERT INTO schema_migrations (nombre) VALUES ($1) ON CONFLICT DO NOTHING [001_a.sql]']),
    );
    expect(sentencias.findIndex((s) => s.includes('[001_a.sql]'))).toBeLessThan(sentencias.findIndex((s) => s.includes('[002_b.sql]')));
    expect(log).toHaveBeenCalledWith('Creando esquema y datos iniciales…');
  });

  it('preparar una base existente aplica solo las migraciones pendientes, en orden', async () => {
    const dir = carpeta({ '001_a.sql': '-- a', '002_b.sql': '-- b', '003_c.sql': '-- c' });
    const { db, sentencias } = bdFalsa(true, ['001_a.sql']);
    const migrador = new Migrador(db, dir, () => undefined);
    expect(await migrador.preparar()).toBe('actualizada');
    expect(sentencias.filter((s) => s.startsWith('-- '))).toEqual(['-- b', '-- c', '-- semilla']);
    const sinPendientes = new Migrador(bdFalsa(true, ['001_a.sql', '002_b.sql', '003_c.sql']).db, dir, () => undefined);
    expect(await sinPendientes.migrate()).toEqual([]);
  });
});
