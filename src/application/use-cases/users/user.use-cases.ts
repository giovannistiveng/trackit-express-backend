import { Actor } from '../../../domain/entities/actor.entity';
import { User } from '../../../domain/entities/user.entity';
import { PasswordHasherPort } from '../../../domain/repositories/services.port';
import { UserRepositoryPort } from '../../../domain/repositories/user.repository.port';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import { AuditService } from '../../services/audit.service';
import { esContrasenaSegura, telefonoOpcional, textoValido } from '../../validation';

const NOMBRES_ROL: Record<number, string> = { 1: 'Administrador', 2: 'Cliente', 3: 'Conductor' };

export interface PerfilUsuario {
  id: number;
  nombre: string;
  correo: string;
  rol: string;
  nombre_rol: string;
  telefono: string | null;
  fecha_registro: string | null;
}

function presentar(u: User): PerfilUsuario {
  return {
    id: u.id as number,
    nombre: u.nombre,
    correo: u.correo,
    rol: String(u.id_rol),
    nombre_rol: NOMBRES_ROL[u.id_rol] ?? 'Usuario',
    telefono: u.telefono ?? null,
    fecha_registro: u.fecha_registro ? u.fecha_registro.toISOString() : null,
  };
}

async function usuarioDelActor(users: UserRepositoryPort, actor: Actor): Promise<User> {
  const u = await users.findById(actor.userId);
  if (!u) throw new NotFoundError('Tu usuario ya no existe');
  return u;
}

/** Perfil del usuario autenticado. */
export class GetMyProfileUseCase {
  constructor(private readonly users: UserRepositoryPort) {}

  async execute(actor: Actor): Promise<PerfilUsuario> {
    return presentar(await usuarioDelActor(this.users, actor));
  }
}

/** Actualiza nombre y teléfono (el correo y el rol no se cambian desde aquí). */
export class UpdateMyProfileUseCase {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, input: { nombre?: unknown; telefono?: unknown }): Promise<PerfilUsuario> {
    const actual = await usuarioDelActor(this.users, actor);
    const nombre = input.nombre === undefined ? actual.nombre : textoValido(input.nombre, 'nombre', 3, 120);
    const telefono = input.telefono === undefined ? (actual.telefono ?? null) : telefonoOpcional(input.telefono);
    const u = await this.users.updateProfile(actor.userId, { nombre, telefono });
    await this.audit.registrar(actor, { accion: 'Perfil actualizado', entidad: 'Usuario', idEntidad: actor.userId });
    return presentar(u);
  }
}

/** Cambio de contraseña: exige la actual y aplica la misma política que el registro. */
export class ChangePasswordUseCase {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly hasher: PasswordHasherPort,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, input: { actual?: unknown; nueva?: unknown }): Promise<void> {
    if (typeof input.actual !== 'string' || typeof input.nueva !== 'string') {
      throw new ValidationError('Escribe tu contraseña actual y la nueva');
    }
    if (!esContrasenaSegura(input.nueva)) {
      throw new ValidationError('La contraseña debe tener al menos 8 caracteres, una mayúscula y un número');
    }
    if (input.actual === input.nueva) throw new ValidationError('La nueva contraseña debe ser distinta de la actual');
    const u = await usuarioDelActor(this.users, actor);
    if (!(await this.hasher.compare(input.actual, u.password_hash))) {
      // 400 y no 401: un 401 cerraría la sesión en el frontend
      throw new ValidationError('La contraseña actual no es correcta');
    }
    await this.users.updatePassword(actor.userId, await this.hasher.hash(input.nueva));
    await this.audit.registrar(actor, { accion: 'Contraseña cambiada', entidad: 'Usuario', idEntidad: actor.userId });
  }
}
