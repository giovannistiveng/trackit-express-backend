import { UserRepositoryPort } from '../../../domain/repositories/user.repository.port';
import { HashService } from '../../../infrastructure/security/hash.service';
import { RegisterUserDTO } from '../../dtos/auth.dto';
import { ValidationError } from '../../../shared/errors';

export class RegisterUserUseCase {
  constructor(
    private userRepository: UserRepositoryPort,
    private hashService: HashService,
  ) {}

  async execute(dto: RegisterUserDTO): Promise<{ id: number; correo: string; nombre: string }> {
    const existingUser = await this.userRepository.findByEmail(dto.correo);
    if (existingUser) {
      throw new ValidationError('El correo ya está registrado');
    }

    const passwordHash = await this.hashService.hash(dto.password);

    const user = await this.userRepository.create({
      nombre: dto.nombre,
      correo: dto.correo,
      password_hash: passwordHash,
      id_rol: dto.id_rol,
    });

    return {
      id: user.id!,
      correo: user.correo,
      nombre: user.nombre,
    };
  }
}