import jwt from 'jsonwebtoken';
import { config } from '../../config';

export interface JWTPayload {
  userId: number;
  email: string;
  role: string;
}

export class JWTService {
  sign(payload: JWTPayload): string {
    return jwt.sign(
      payload,
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn } as jwt.SignOptions
    );
  }

  verify(token: string): JWTPayload | null {
    try {
      return jwt.verify(token, config.jwt.secret) as JWTPayload;
    } catch {
      return null;
    }
  }
}
