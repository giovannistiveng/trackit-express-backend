import { ROLES } from '../../../domain/entities/actor.entity';
import { UserRepositoryPort } from '../../../domain/repositories/user.repository.port';
import { PasswordHasherPort } from '../../../domain/repositories/services.port';
import { ValidationError } from '../../../shared/errors';
import { AuditService } from '../../services/audit.service';
import { esContrasenaSegura, esCorreo, textoValido } from '../../validation';

export interface RegisterUserInput {
  nombre: unknown;
  correo: unknown;
  password: unknown;
  id_rol: unknown;
}

/** CU-001: registro público de clientes y conductores. */
export class RegisterUserUseCase {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly hasher: PasswordHasherPort,
    private readonly audit: AuditService,
  ) {}

  async execute(input: RegisterUserInput): Promise<{ id: number; correo: string; nombre: string }> {
    const nombre = textoValido(input.nombre, 'nombre', 2, 120);
    const correo = typeof input.correo === 'string' ? input.correo.trim().toLowerCase() : '';
    if (!esCorreo(correo)) throw new ValidationError('El correo no tiene un formato válido');
    const password = typeof input.password === 'string' ? input.password : '';
    if (!esContrasenaSegura(password)) {
      throw new ValidationError('La contraseña debe tener al menos 8 caracteres, una mayúscula y un número');
    }
    const idRol = Number(input.id_rol);
    if (idRol !== ROLES.CLIENTE && idRol !== ROLES.CONDUCTOR) {
      throw new ValidationError('Solo se pueden registrar cuentas de Cliente o Conductor');
    }

    if (await this.users.findByEmail(correo)) {
      throw new ValidationError('El correo ya está registrado');
    }

    const user = await this.users.create({
      nombre,
      correo,
      password_hash: await this.hasher.hash(password),
      id_rol: idRol,
    });

    await this.audit.registrar(
      { userId: user.id as number, email: user.correo },
      { accion: 'Registro de usuario', entidad: 'Usuario', idEntidad: user.id, detalle: idRol === ROLES.CONDUCTOR ? 'Conductor' : 'Cliente' },
    );
    return { id: user.id as number, correo: user.correo, nombre: user.nombre };
  }
}
