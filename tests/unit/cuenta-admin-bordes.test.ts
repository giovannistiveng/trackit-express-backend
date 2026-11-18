import { describe, it, expect, jest } from '@jest/globals';
import {
  DeleteZoneUseCase,
  ListContactsUseCase,
  SearchAuditUseCase,
  UpdateZoneUseCase,
} from '../../src/application/use-cases/admin/admin.use-cases';
import {
  RequestPasswordResetUseCase,
  ResetPasswordUseCase,
  SendVerificationEmailUseCase,
} from '../../src/application/use-cases/auth/account-recovery.use-cases';
import { RegisterUserUseCase } from '../../src/application/use-cases/auth/register-user.use-case';
import { ListNotificationsUseCase } from '../../src/application/use-cases/notifications/notification.use-cases';
import { SubmitContactUseCase } from '../../src/application/use-cases/public/public.use-cases';
import { SubscribePushUseCase } from '../../src/application/use-cases/realtime/push.use-cases';
import { ChangePasswordUseCase, GetMyProfileUseCase, UpdateMyProfileUseCase } from '../../src/application/use-cases/users/user.use-cases';
import { User } from '../../src/domain/entities/user.entity';
import { UserRepositoryPort } from '../../src/domain/ports/user.repository.port';
import { NotFoundError, ValidationError } from '../../src/shared/errors';
import { ADMIN, CLIENTE, auditFalso } from '../helpers/fakes';

const AHORA = () => new Date('2026-11-18T17:00:00Z');
const audit = () => auditFalso().audit;

/** Repositorio de usuarios mínimo: un usuario o ninguno. */
function usuarios(u: User | null): UserRepositoryPort {
  return {
    create: jest.fn(async (n: Omit<User, 'id'>) => ({ ...n, id: 9 })),
    findByEmail: jest.fn(async () => u),
    findById: jest.fn(async () => u),
    updateProfile: jest.fn(async (_id: number, d: { nombre: string; telefono: string | null }) => ({ ...(u as User), ...d })),
    updatePassword: jest.fn(async () => undefined),
    markEmailVerified: jest.fn(async () => undefined),
  };
}
const ANA: User = { id: 10, nombre: 'Ana Ruiz', correo: 'ana@t.co', password_hash: 'h', id_rol: 2 };
const tokens = (id: number | null) => ({ create: jest.fn(async () => undefined), consume: jest.fn(async () => id) });
const mailer = (falla = false) => ({ enviar: jest.fn(async () => (falla ? Promise.reject(new Error('smtp')) : undefined)) });
const hasher = { hash: async (p: string) => `h(${p})`, compare: async (a: string, b: string) => `h(${a})` === b };

describe('cuenta: verificación y recuperación', () => {
  it('sin usuario el envío de verificación responde 404; con correo ya verificado no reenvía', async () => {
    await expect(new SendVerificationEmailUseCase(usuarios(null), tokens(1), mailer(), 'http://f', AHORA).execute(CLIENTE)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const ok = new SendVerificationEmailUseCase(usuarios({ ...ANA, correo_verificado: true }), tokens(1), mailer(), 'http://f', AHORA);
    expect(await ok.execute(CLIENTE)).toEqual({ enviado: false });
  });

  it('olvidé mi contraseña rechaza un correo que no es texto', async () => {
    const uc = new RequestPasswordResetUseCase(usuarios(ANA), tokens(1), mailer(), 'http://f', audit(), AHORA);
    await expect(uc.execute({ correo: 42 })).rejects.toThrow('formato válido');
  });

  it('restablecer: contraseña que no es texto, usuario borrado y correo de aviso que falla', async () => {
    const sinNueva = new ResetPasswordUseCase(usuarios(ANA), tokens(10), hasher, mailer(), audit(), AHORA);
    await expect(sinNueva.execute({ token: 'a'.repeat(64), nueva: 12345678 })).rejects.toThrow('al menos 8');
    const borrado = new ResetPasswordUseCase(usuarios(null), tokens(10), hasher, mailer(), audit(), AHORA);
    await expect(borrado.execute({ token: 'a'.repeat(64), nueva: 'Nueva2026' })).rejects.toBeInstanceOf(NotFoundError);
    const m = mailer(true);
    const ok = new ResetPasswordUseCase(usuarios(ANA), tokens(10), hasher, m, audit(), AHORA);
    await expect(ok.execute({ token: 'a'.repeat(64), nueva: 'Nueva2026' })).resolves.toBeUndefined();
    expect(m.enviar).toHaveBeenCalled();
  });

  it('el registro valida correo y contraseña que no son texto y no falla si el correo de verificación falla', async () => {
    const verificacion = { enviarA: jest.fn(async () => Promise.reject(new Error('smtp'))) } as unknown as SendVerificationEmailUseCase;
    const uc = new RegisterUserUseCase(usuarios(null), hasher, audit(), verificacion);
    await expect(uc.execute({ nombre: 'Ana', correo: 1, password: 'Clave2026', id_rol: 2 })).rejects.toThrow('formato válido');
    await expect(uc.execute({ nombre: 'Ana', correo: 'ana@t.co', password: 1, id_rol: 2 })).rejects.toThrow('al menos 8');
    expect(await uc.execute({ nombre: 'Ana', correo: 'ana@t.co', password: 'Clave2026', id_rol: 2 })).toMatchObject({ id: 9 });
    expect(verificacion.enviarA).toHaveBeenCalled();
  });
});

describe('perfil del usuario', () => {
  it('presenta un rol desconocido como Usuario y sin fecha de registro', async () => {
    const p = await new GetMyProfileUseCase(usuarios({ ...ANA, id_rol: 99 })).execute(CLIENTE);
    expect(p).toMatchObject({ nombre_rol: 'Usuario', fecha_registro: null, telefono: null });
    await expect(new GetMyProfileUseCase(usuarios(null)).execute(CLIENTE)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('actualizar sin teléfono conserva el actual (o ninguno)', async () => {
    const conTel = usuarios({ ...ANA, telefono: '3001234567' });
    await new UpdateMyProfileUseCase(conTel, audit()).execute(CLIENTE, { nombre: 'Ana María' });
    expect(conTel.updateProfile).toHaveBeenCalledWith(CLIENTE.userId, { nombre: 'Ana María', telefono: '3001234567' });
    const sinTel = usuarios(ANA);
    await new UpdateMyProfileUseCase(sinTel, audit()).execute(CLIENTE, {});
    expect(sinTel.updateProfile).toHaveBeenCalledWith(CLIENTE.userId, { nombre: 'Ana Ruiz', telefono: null });
  });

  it('cambio de contraseña exige ambos textos y que sean distintas', async () => {
    const uc = new ChangePasswordUseCase(usuarios(ANA), hasher, audit());
    await expect(uc.execute(CLIENTE, { actual: 'Clave2026' })).rejects.toThrow('Escribe tu contraseña actual y la nueva');
    await expect(uc.execute(CLIENTE, { actual: 'Clave2026', nueva: 'Clave2026' })).rejects.toThrow('distinta de la actual');
  });
});

describe('administración: paginación y zonas', () => {
  it('auditoría y contactos con paginación por defecto o inválida', async () => {
    const search = jest.fn(async () => ({ items: [], total: 0 }));
    await new SearchAuditUseCase({ search } as never).execute(ADMIN, {});
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ pagina: 1, tamano: 15 }));
    await new SearchAuditUseCase({ search } as never).execute(ADMIN, { pagina: 'x', tamano: 'y' });
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ pagina: 1, tamano: 15 }));
    const contactos = { search: jest.fn(async () => ({ items: [{ id: 1, nombre: 'A', correo: 'a@t.co', asunto: 'General', mensaje: 'm' }], total: 1 })) };
    const r = await new ListContactsUseCase(contactos as never).execute(ADMIN, { pagina: '0', tamano: 'muchos' });
    expect(r).toMatchObject({ pagina: 1, tamano: 15 });
    expect(r.items[0].fecha).toEqual(expect.any(String));
  });

  it('editar o borrar una zona que desaparece entre lecturas responde 404', async () => {
    const zona = { id_zona: 2, nombre_zona: 'Vereda', tarifa_base: 0, centro: null };
    const zonas = {
      findById: jest.fn(async () => zona),
      findAll: jest.fn(async () => [zona, { ...zona, id_zona: 3 }]),
      update: jest.fn(async () => null),
      remove: jest.fn(async () => null),
    };
    await expect(new UpdateZoneUseCase(zonas as never, audit()).execute(ADMIN, 2, { tarifa_base: 1000 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new DeleteZoneUseCase(zonas as never, audit()).execute(ADMIN, 2)).rejects.toBeInstanceOf(NotFoundError);
    zonas.findAll.mockImplementation(async () => [zona]);
    await expect(new DeleteZoneUseCase(zonas as never, audit()).execute(ADMIN, 2)).rejects.toThrow('única zona activa');
    zonas.findById.mockImplementation(async () => null as never);
    await expect(new DeleteZoneUseCase(zonas as never, audit()).execute(ADMIN, 2)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('sitio público, push y avisos', () => {
  it('contacto con un correo que no es texto', async () => {
    const uc = new SubmitContactUseCase({ save: jest.fn() } as never, audit());
    await expect(uc.execute({ nombre: 'Ana', correo: 7, mensaje: 'Hola, necesito un trasteo' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('push: endpoint o token que no son texto', async () => {
    const uc = new SubscribePushUseCase({ save: jest.fn() } as never);
    await expect(uc.execute(CLIENTE, { endpoint: 1, keys: { p256dh: 'a', auth: 'b' } })).rejects.toThrow('suscripción del navegador');
    await expect(uc.execute(CLIENTE, { plataforma: 'android', token: 1 })).rejects.toThrow('token del dispositivo');
  });

  it('avisos: sin parámetros, límite inválido y sin fecha', async () => {
    const repo = {
      findByUser: jest.fn(async () => [{ id: 1, id_usuario: 10, tipo: 'nuevo_servicio', titulo: 't', mensaje: 'm' }]),
      countUnread: jest.fn(async () => 1),
    };
    const r = await new ListNotificationsUseCase(repo as never).execute(CLIENTE);
    expect(repo.findByUser).toHaveBeenCalledWith(CLIENTE.userId, { soloNoLeidas: false, limite: 30 });
    expect(r.items[0]).toMatchObject({ id_envio: null, leida: false, fecha: expect.any(String) });
    await new ListNotificationsUseCase(repo as never).execute(CLIENTE, { limite: 'x' });
    expect(repo.findByUser).toHaveBeenLastCalledWith(CLIENTE.userId, { soloNoLeidas: false, limite: 30 });
  });
});
