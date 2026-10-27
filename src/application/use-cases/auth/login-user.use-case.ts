import { UserRepositoryPort } from '../../../domain/repositories/user.repository.port';
import { HashService } from '../../../infrastructure/security/hash.service';
import { JWTService } from '../../../infrastructure/security/jwt.service';
import { LoginDTO, AuthResponse } from '../../dtos/auth.dto';
import { ValidationError, UnauthorizedError } from '../../../shared/errors';

export class LoginUserUseCase {
  constructor(
    private userRepository: UserRepositoryPort,
    private hashService: HashService,
    private jwtService: JWTService,
  ) {}

  async execute(dto: LoginDTO): Promise<AuthResponse> {
    const user = await this.userRepository.findByEmail(dto.correo);
    if (!user) {
      throw new UnauthorizedError('Credenciales inválidas');
    }

    const isPasswordValid = await this.hashService.compare(dto.password, user.password_hash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Credenciales inválidas');
    }

    const token = this.jwtService.sign({
      userId: user.id!,
      email: user.correo,
      role: String(user.id_rol),
    });

    return {
      user: {
        id: user.id!,
        nombre: user.nombre,
        correo: user.correo,
        rol: String(user.id_rol),
      },
      token,
    };
  }
}