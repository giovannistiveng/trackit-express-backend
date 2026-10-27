import bcrypt from 'bcryptjs';
import { config } from '../../config';

export class HashService {
  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, config.bcrypt.saltRounds);
  }

  async compare(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}