import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { TokenPayload, TokenServicePort } from '../../domain/repositories/services.port';

export type JWTPayload = TokenPayload;

export class JWTService implements TokenServicePort {
  constructor(
    private readonly secret: string = config.jwt.secret,
    private readonly expiresIn: string = config.jwt.expiresIn,
  ) {}

  sign(payload: TokenPayload): string {
    return jwt.sign(payload, this.secret, { expiresIn: this.expiresIn } as jwt.SignOptions);
  }

  verify(token: string): TokenPayload | null {
    try {
      const p = jwt.verify(token, this.secret) as Partial<TokenPayload>;
      return typeof p.userId === 'number' && typeof p.role === 'string' ? { userId: p.userId, email: p.email ?? '', role: p.role } : null;
    } catch {
      return null;
    }
  }
}
