import { UserRepositoryPort } from '../../../domain/repositories/user.repository.port';
import { PasswordHasherPort, TokenServicePort } from '../../../domain/repositories/services.port';
import { UnauthorizedError } from '../../../shared/errors';
import { AuditService } from '../../services/audit.service';

export interface AuthResponse {
  user: { id: number; nombre: string; correo: string; rol: string };
  token: string;
}

/** CU-002: inicio de sesión. Nunca revela si falló el correo o la contraseña. */
export class LoginUserUseCase {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly hasher: PasswordHasherPort,
    private readonly tokens: TokenServicePort,
    private readonly audit: AuditService,
  ) {}

  async execute(input: { correo: unknown; password: unknown }): Promise<AuthResponse> {
    const correo = typeof input.correo === 'string' ? input.correo.trim().toLowerCase() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    if (!correo || !password) throw new UnauthorizedError('Credenciales inválidas');

    const user = await this.users.findByEmail(correo);
    if (!user || !(await this.hasher.compare(password, user.password_hash))) {
      throw new UnauthorizedError('Credenciales inválidas');
    }

    const rol = String(user.id_rol);
    const token = this.tokens.sign({ userId: user.id as number, email: user.correo, role: rol });
    await this.audit.registrar({ userId: user.id as number, email: user.correo }, { accion: 'Inicio de sesión', entidad: 'Usuario', idEntidad: user.id });
    return { user: { id: user.id as number, nombre: user.nombre, correo: user.correo, rol }, token };
  }
}
