import { randomBytes } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import nodemailer, { Transporter } from 'nodemailer';
import { CorreoSaliente, MailerPort } from '../../domain/ports/platform.ports';
import { logger } from '../../shared/logger';

const log = logger.child('Correo');

export interface ConfigSmtp {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  remitente: string;
}

/** Correo real por SMTP (Gmail, Outlook, SendGrid, Amazon SES, Brevo…). */
export class SmtpMailer implements MailerPort {
  private readonly transporte: Transporter;

  constructor(
    private readonly c: ConfigSmtp,
    transporte?: Transporter,
  ) {
    this.transporte =
      transporte ??
      nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.secure,
        auth: c.user ? { user: c.user, pass: c.pass } : undefined,
      });
  }

  async enviar(m: CorreoSaliente): Promise<void> {
    await this.transporte.sendMail({ from: this.c.remitente, to: m.para, subject: m.asunto, html: m.html, text: m.texto });
    log.info(`Correo enviado a ${ocultarCorreo(m.para)}: ${m.asunto}`);
  }
}

/**
 * Desarrollo sin SMTP: guarda cada correo como .html en una carpeta y escribe en el log el
 * enlace principal, para poder probar la verificación y la recuperación sin servidor de correo.
 */
export class BuzonLocalMailer implements MailerPort {
  constructor(private readonly carpeta: string) {}

  async enviar(m: CorreoSaliente): Promise<void> {
    mkdirSync(this.carpeta, { recursive: true });
    const unico = randomBytes(3).toString('hex');
    const nombre = `${new Date().toISOString().replace(/[:.]/g, '-')}-${unico}-${m.para.replace(/[^a-z0-9]/gi, '_')}.html`;
    const ruta = path.join(this.carpeta, nombre);
    writeFileSync(ruta, m.html, 'utf8');
    const enlace = /https?:\/\/[^\s"'<>]+/.exec(m.texto)?.[0];
    const detalle = enlace ? ` · Enlace: ${enlace}` : '';
    log.warn(`[Modo desarrollo] Correo para ${m.para}: "${m.asunto}" guardado en ${ruta}${detalle}`);
  }
}

export function ocultarCorreo(correo: string): string {
  const [u, d] = correo.split('@');
  return `${u.slice(0, 2)}***@${d ?? ''}`;
}
