import { User } from '../entities/user.entity';

export interface UserRepositoryPort {
  create(user: Omit<User, 'id'>): Promise<User>;
  findByEmail(correo: string): Promise<User | null>;
  findById(id: number): Promise<User | null>;
}