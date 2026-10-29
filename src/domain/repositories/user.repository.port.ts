import { User } from '../entities/user.entity';

export interface UserRepositoryPort {
  /** Crea el usuario; si su rol es Conductor crea también su perfil, en la misma transacción. */
  create(user: Omit<User, 'id'>): Promise<User>;
  findByEmail(correo: string): Promise<User | null>;
  findById(id: number): Promise<User | null>;
  updateProfile(id: number, datos: { nombre: string; telefono: string | null }): Promise<User>;
  updatePassword(id: number, passwordHash: string): Promise<void>;
}
