import bcrypt from 'bcryptjs';
import { config } from '../../config';
import { PasswordHasherPort } from '../../domain/repositories/services.port';

export class HashService implements PasswordHasherPort {
  hash(password: string): Promise<string> {
    return bcrypt.hash(password, config.bcrypt.saltRounds);
  }

  compare(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}
