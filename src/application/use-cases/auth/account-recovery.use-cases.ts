import { createHash, randomBytes } from 'crypto';
import { Actor } from '../../../domain/entities/actor.entity';
import { User } from '../../../domain/entities/user.entity';
import { MailerPort, TokenRepositoryPort } from '../../../domain/repositories/platform.ports';
import { PasswordHasherPort } from '../../../domain/repositories/services.port';
import { UserRepositoryPort } from '../../../domain/repositories/user.repository.port';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import { AuditService } from '../../services/audit.service';
import { correoContrasenaCambiada, correoRecuperacion, correoVerificacion } from '../../services/plantillas-correo';
import { esContrasenaSegura, esCorreo } from '../../validation';

export const VIGENCIA_RECUPERACION_MS = 60 * 60_000;
export const VIGENCIA_VERIFICACION_MS = 48 * 60 * 60_000;

/** Token aleatorio de 32 bytes; en la base de datos solo se guarda su SHA-256. */
export function nuevoToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function tokenDeEntrada(valor: unknown): string {
  if (typeof valor !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(valor)) throw new ValidationError('El enlace no es válido');
  return valor;
}

/** Envía (o reenvía) el enlace para confirmar el correo. */
export class SendVerificationEmailUseCase {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly tokens: TokenRepositoryPort,
    private readonly mailer: MailerPort,
    private readonly urlFrontend: string,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async execute(actor: Actor): Promise<{ enviado: boolean }> {
    const u = await this.users.findById(actor.userId);
    if (!u) throw new NotFoundError('Tu usuario ya no existe');
    if (u.correo_verificado) return { enviado: false };
    await this.enviarA(u);
    return { enviado: true };
  }

  async enviarA(u: User): Promise<void> {
    const { token, hash } = nuevoToken();
    await this.tokens.create(u.id as number, 'verificacion', hash, new Date(this.reloj().getTime() + VIGENCIA_VERIFICACION_MS));
    await this.mailer.enviar(correoVerificacion(u.correo, u.nombre, `${this.urlFrontend}/verificar-correo?token=${token}`));
  }
}

/** Confirma el correo con el enlace recibido. */
export class VerifyEmailUseCase {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly tokens: TokenRepositoryPort,
    private readonly audit: AuditService,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async execute(input: { token?: unknown }): Promise<{ correo_verificado: true }> {
    const id = await this.tokens.consume('verificacion', hashToken(tokenDeEntrada(input.token)), this.reloj());
    if (!id) throw new ValidationError('El enlace de verificación venció o ya se usó. Pide uno nuevo desde tu cuenta');
    await this.users.markEmailVerified(id);
    const u = await this.users.findById(id);
    await this.audit.registrar({ userId: id, email: u?.correo }, { accion: 'Correo verificado', entidad: 'Usuario', idEntidad: id });
    return { correo_verificado: true };
  }
}

/**
 * "Olvidé mi contraseña". Siempre responde lo mismo, exista o no el correo, para no revelar
 * qué cuentas están registradas.
 */
export class RequestPasswordResetUseCase {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly tokens: TokenRepositoryPort,
    private readonly mailer: MailerPort,
    private readonly urlFrontend: string,
    private readonly audit: AuditService,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async execute(input: { correo?: unknown }): Promise<void> {
    const correo = typeof input.correo === 'string' ? input.correo.trim().toLowerCase() : '';
    if (!esCorreo(correo)) throw new ValidationError('El correo no tiene un formato válido');
    const u = await this.users.findByEmail(correo);
    if (!u) return;
    const { token, hash } = nuevoToken();
    await this.tokens.create(u.id as number, 'recuperacion', hash, new Date(this.reloj().getTime() + VIGENCIA_RECUPERACION_MS));
    await this.mailer.enviar(correoRecuperacion(u.correo, u.nombre, `${this.urlFrontend}/restablecer-contrasena?token=${token}`));
    await this.audit.registrar({ userId: u.id as number, email: u.correo }, { accion: 'Recuperación solicitada', entidad: 'Usuario', idEntidad: u.id });
  }
}

/** Cambia la contraseña con el enlace del correo. También confirma el correo (lo recibió). */
export class ResetPasswordUseCase {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly tokens: TokenRepositoryPort,
    private readonly hasher: PasswordHasherPort,
    private readonly mailer: MailerPort,
    private readonly audit: AuditService,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async execute(input: { token?: unknown; nueva?: unknown }): Promise<void> {
    const token = tokenDeEntrada(input.token);
    const nueva = typeof input.nueva === 'string' ? input.nueva : '';
    if (!esContrasenaSegura(nueva)) throw new ValidationError('La contraseña debe tener al menos 8 caracteres, una mayúscula y un número');
    const id = await this.tokens.consume('recuperacion', hashToken(token), this.reloj());
    if (!id) throw new ValidationError('El enlace para restablecer la contraseña venció o ya se usó. Pide uno nuevo');
    const u = await this.users.findById(id);
    if (!u) throw new NotFoundError('Tu usuario ya no existe');
    await this.users.updatePassword(id, await this.hasher.hash(nueva));
    await this.users.markEmailVerified(id);
    await this.audit.registrar({ userId: id, email: u.correo }, { accion: 'Contraseña restablecida', entidad: 'Usuario', idEntidad: id });
    await this.mailer.enviar(correoContrasenaCambiada(u.correo, u.nombre)).catch(() => undefined);
  }
}
