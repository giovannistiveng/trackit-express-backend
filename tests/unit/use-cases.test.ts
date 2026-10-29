import { AuditService } from '../../src/application/services/audit.service';
import { presentarEnvio } from '../../src/application/services/envio.presenter';
import { esContrasenaSegura, idValido, textoValido } from '../../src/application/validation';
import { LoginUserUseCase } from '../../src/application/use-cases/auth/login-user.use-case';
import { calcularTarifa, categoriaOpcional, ListZonesUseCase } from '../../src/application/use-cases/catalog/catalog.use-cases';
import { generarPin, ListClientShipmentsUseCase, TrackShipmentUseCase } from '../../src/application/use-cases/shipments/client-shipments.use-cases';
import {
  GetLastLocationUseCase,
  RecordLocationUseCase,
  UploadEvidenceUseCase,
  ValidateDeliveryUseCase,
} from '../../src/application/use-cases/shipments/driver-shipments.use-cases';
import {
  DecideDriverApprovalUseCase,
  GetDriverProfileUseCase,
  normalizarPlaca,
  RegisterVehicleUseCase,
  UploadDriverDocumentUseCase,
} from '../../src/application/use-cases/drivers/driver.use-cases';
import { SearchAuditUseCase } from '../../src/application/use-cases/admin/admin.use-cases';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../../src/shared/errors';
import { ADMIN, CLIENTE, CONDUCTOR, FakeAuditRepo, FakeDrivers, FakeShipments, FakeVehicles, auditFalso, conductorAprobado, envio } from '../helpers/fakes';

const storage = { upload: jest.fn(async () => 'https://cdn/x.jpg') };
const JPG = { buffer: Buffer.from('x'), mimetype: 'image/jpeg', originalname: 'f.jpg' };

describe('validación', () => {
  it('idValido acepta enteros positivos y textos numéricos', () => {
    expect(idValido('12', 'id')).toBe(12);
    expect(idValido(3, 'id')).toBe(3);
    expect(() => idValido('1.5', 'id')).toThrow(ValidationError);
    expect(() => idValido(0, 'id')).toThrow('El campo id no es válido');
  });
  it('textoValido recorta espacios y valida longitudes', () => {
    expect(textoValido('  a   b ', 'x', 1, 5)).toBe('a b');
    expect(() => textoValido(42, 'x', 1, 5)).toThrow(ValidationError);
  });
  it('esContrasenaSegura exige 8 caracteres, mayúscula y número', () => {
    expect(esContrasenaSegura('Clave1234')).toBe(true);
    expect(esContrasenaSegura('clave1234')).toBe(false);
  });
});

describe('catálogo', () => {
  it('calcula la tarifa con dos decimales y valida la categoría', () => {
    expect(calcularTarifa(5000, 34.567)).toBe(39567);
    expect(categoriaOpcional('')).toBeNull();
    expect(categoriaOpcional('Motocarro')).toBe('Motocarro');
    expect(() => categoriaOpcional('Avión')).toThrow(ValidationError);
  });
  it('lista zonas', async () => {
    const z = [{ id_zona: 1, nombre_zona: 'A', tarifa_base: 1 }];
    expect(await new ListZonesUseCase({ findAll: async () => z, findById: async () => null }).execute()).toBe(z);
  });
  it('genera PIN de 4 dígitos', () => {
    expect(generarPin(() => 0)).toBe('1000');
    expect(generarPin(() => 0.9999)).toBe('9999');
  });
});

describe('LoginUserUseCase', () => {
  it('rechaza correo o contraseña vacíos sin consultar', async () => {
    const users = { findByEmail: jest.fn(), create: jest.fn(), findById: jest.fn() };
    const uc = new LoginUserUseCase(users, { hash: jest.fn(), compare: jest.fn() }, { sign: jest.fn(), verify: jest.fn() }, auditFalso().audit);
    await expect(uc.execute({ correo: '', password: 'x' })).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(uc.execute({ correo: 5, password: 5 })).rejects.toBeInstanceOf(UnauthorizedError);
    expect(users.findByEmail).not.toHaveBeenCalled();
  });
});

describe('AuditService', () => {
  it('no interrumpe la operación si guardar falla, y recorta el detalle', async () => {
    const fallos: unknown[] = [];
    const repo = new FakeAuditRepo();
    const ok = new AuditService(repo);
    await ok.registrar(null, { accion: 'X', entidad: 'Y', detalle: 'd'.repeat(600) });
    expect(repo.registros[0]).toMatchObject({ id_usuario: null, detalle: 'd'.repeat(500), id_entidad: null });
    const roto = new AuditService({ save: async () => { throw new Error('db'); }, search: jest.fn() }, (e) => fallos.push(e));
    await expect(roto.registrar(CLIENTE, { accion: 'X', entidad: 'Y' })).resolves.toBeUndefined();
    expect(fallos).toHaveLength(1);
    await new AuditService({ save: async () => { throw new Error('db'); }, search: jest.fn() }).registrar(null, { accion: 'X', entidad: 'Y' });
  });
});

describe('presentarEnvio', () => {
  it('oculta el PIN sin incluirPin y usa fecha_creacion cuando no hay historial', () => {
    const f = new Date('2026-01-01T00:00:00Z');
    const r = presentarEnvio(envio({ fecha_creacion: f, estado: undefined }), { incluirPin: false, historial: [] });
    expect(r.pin_seguridad).toBeUndefined();
    expect(r).toMatchObject({ estado: 'Pendiente', ultimo_cambio_estado: 'Pendiente', fecha_ultimo_cambio: f.toISOString() });
  });
  it('toma fecha, calificación y conductor del envío detallado', () => {
    const r = presentarEnvio({ ...envio(), fecha_ultimo_cambio: new Date(0), calificacion: null, conductor: { nombre: 'C' } }, { incluirPin: true });
    expect(r).toMatchObject({ pin_seguridad: '1234', fecha_ultimo_cambio: new Date(0).toISOString(), calificado: false, conductor: { nombre: 'C' } });
  });
});

describe('ListClientShipmentsUseCase', () => {
  it('filtra por un estado concreto y exige rol cliente', async () => {
    const s = new FakeShipments();
    s.envios.set(1, envio({ estado: 'Asignado' }));
    s.envios.set(2, envio({ id_envio: 2, estado: 'Pendiente' }));
    const uc = new ListClientShipmentsUseCase(s);
    expect((await uc.execute(CLIENTE, 'Asignado')).map((e) => e.id_envio)).toEqual([1]);
    expect(await uc.execute(CLIENTE)).toHaveLength(2);
    await expect(uc.execute(CONDUCTOR)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('TrackShipmentUseCase', () => {
  it('niega a un conductor sin perfil y a uno no asignado cuando el envío ya tiene conductor', async () => {
    const s = new FakeShipments();
    const d = new FakeDrivers();
    s.envios.set(1, envio({ estado: 'Asignado', id_conductor: 99 }));
    const uc = new TrackShipmentUseCase(s, d, new FakeVehicles());
    await expect(uc.execute(CONDUCTOR, 1)).rejects.toBeInstanceOf(ForbiddenError);
    conductorAprobado(d);
    await expect(uc.execute(CONDUCTOR, 1)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('el administrador ve el envío sin PIN y sin datos del conductor si no existe', async () => {
    const s = new FakeShipments();
    s.envios.set(1, envio({ estado: 'Asignado', id_conductor: 99 }));
    const r = await new TrackShipmentUseCase(s, new FakeDrivers(), new FakeVehicles()).execute(ADMIN, 1);
    expect(r.pin_seguridad).toBeUndefined();
    expect(r.conductor).toBeUndefined();
  });
});

describe('casos de uso del conductor', () => {
  let s: FakeShipments;
  let d: FakeDrivers;
  beforeEach(() => {
    s = new FakeShipments();
    d = new FakeDrivers();
    conductorAprobado(d);
    s.envios.set(1, envio({ estado: 'En Ruta', id_conductor: 5 }));
  });

  it('crea el perfil de un conductor antiguo al consultarlo', async () => {
    const d2 = new FakeDrivers();
    const p = await new GetDriverProfileUseCase(d2, new FakeVehicles()).execute(CONDUCTOR);
    expect(p).toMatchObject({ estado_aprobacion: 'Pendiente', vehiculo: null, motivo_rechazo: null });
    await expect(new GetDriverProfileUseCase(d2, new FakeVehicles()).execute(CLIENTE)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('la evidencia exige archivo, tipo de imagen y En Ruta', async () => {
    const uc = new UploadEvidenceUseCase(s, d, storage);
    await expect(uc.execute(CONDUCTOR, 1)).rejects.toThrow('No se proporcionó ningún archivo');
    await expect(uc.execute(CONDUCTOR, 1, { ...JPG, mimetype: 'image/gif' })).rejects.toThrow('La foto debe ser JPG o PNG');
    expect(await uc.execute(CONDUCTOR, 1, JPG)).toEqual({ url_foto: 'https://cdn/x.jpg' });
    s.envios.set(1, envio({ estado: 'Asignado', id_conductor: 5 }));
    await expect(uc.execute(CONDUCTOR, 1, JPG)).rejects.toThrow('Inicia la ruta antes de registrar la evidencia');
  });

  it('la entrega exige PIN', async () => {
    const uc = new ValidateDeliveryUseCase(s, d, auditFalso().audit);
    await expect(uc.execute(CONDUCTOR, 1, { url_foto: 'https://x/y.jpg', pin_seguridad: '' })).rejects.toThrow('El PIN de seguridad es obligatorio');
    expect((await uc.execute(CONDUCTOR, 1, { url_foto: 'https://x/y.jpg', pin_seguridad: 1234 })).estado).toBe('Entregado');
  });

  it('la ubicación valida la fecha y el estado del servicio', async () => {
    const guardar = jest.fn();
    const uc = new RecordLocationUseCase(s, d, { save: guardar, findLast: jest.fn() });
    await expect(uc.execute(CONDUCTOR, 1, { lat: 1, lon: 1, capturado_en: 'ayer' })).rejects.toThrow('La fecha de captura no es válida');
    await uc.execute(CONDUCTOR, 1, { lat: '4.3', lon: '-74.3' });
    expect(guardar).toHaveBeenCalledWith(expect.objectContaining({ lat: 4.3, lon: -74.3, capturado_en: expect.any(Date) }));
    s.envios.set(1, envio({ estado: 'Entregado', id_conductor: 5 }));
    await expect(uc.execute(CONDUCTOR, 1, { lat: 1, lon: 1 })).rejects.toThrow('Solo se comparte la ubicación durante un servicio activo');
  });

  it('el conductor asignado puede leer la última ubicación; otro no', async () => {
    const uc = new GetLastLocationUseCase(s, d, { save: jest.fn(), findLast: async () => ({ id_envio: 1, lat: 1, lon: 2, capturado_en: new Date(0) }) });
    expect(await uc.execute(CONDUCTOR, 1)).toEqual({ lat: 1, lon: 2, capturado_en: new Date(0).toISOString() });
    await expect(uc.execute({ ...CONDUCTOR, userId: 777 }, 1)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('registrar vehículo valida la categoría', async () => {
    const uc = new RegisterVehicleUseCase(new FakeVehicles(), d, auditFalso().audit);
    await expect(uc.execute(CONDUCTOR, { placa: 'ABC123', categoria: 'Bicicleta' })).rejects.toThrow('Categoría inválida');
    expect(normalizarPlaca(undefined)).toBe('');
  });

  it('subir documento valida tipo de documento, archivo y tipo de archivo', async () => {
    const uc = new UploadDriverDocumentUseCase({ create: jest.fn(), findByConductor: jest.fn() }, d, storage, auditFalso().audit);
    await expect(uc.execute(CONDUCTOR, { tipo_documento: 'Pasaporte' }, JPG)).rejects.toThrow('Tipo de documento inválido');
    await expect(uc.execute(CONDUCTOR, { tipo_documento: 'SOAT' })).rejects.toThrow('No se proporcionó ningún archivo');
    await expect(uc.execute(CONDUCTOR, { tipo_documento: 'SOAT' }, { ...JPG, mimetype: 'text/plain' })).rejects.toThrow('Solo se permiten imágenes o PDF');
    await expect(uc.execute(CONDUCTOR, { tipo_documento: 'SOAT', id_conductor: 999 }, JPG)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('administración', () => {
  it('decidir aprobación valida el id y el booleano', async () => {
    const uc = new DecideDriverApprovalUseCase(new FakeDrivers(), auditFalso().audit);
    await expect(uc.execute(ADMIN, { driverId: 'x', approved: true })).rejects.toThrow('driverId');
    await expect(uc.execute(ADMIN, { driverId: 1, approved: 'si' })).rejects.toThrow('"approved"');
    await expect(uc.execute(CLIENTE, { driverId: 1, approved: true })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('la auditoría normaliza página y tamaño', async () => {
    const repo = new FakeAuditRepo();
    const buscar = jest.spyOn(repo, 'search');
    await new SearchAuditUseCase(repo).execute(ADMIN, { pagina: 'abc', tamano: '5000', texto: '  ', accion: 'Login' });
    expect(buscar).toHaveBeenCalledWith({ pagina: 1, tamano: 1000, texto: undefined, accion: 'Login' });
    repo.registros.push({ accion: 'A', entidad: 'B' });
    const r = await new SearchAuditUseCase(repo).execute(ADMIN, {});
    expect(r.items[0]).toMatchObject({ usuario: 'Sistema', detalle: '' });
  });
});
