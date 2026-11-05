import { randomBytes } from 'crypto';
import { EstadoGateway, PaymentGatewayPort } from '../../domain/ports/platform.ports';
import { logger } from '../../shared/logger';

const log = logger.child('Nequi');

type Fetch = typeof fetch;

export interface ConfigNequi {
  clientId: string;
  clientSecret: string;
  apiKey: string;
  authUrl: string;
  apiUrl: string;
  codigoComercio: string;
}

export class ErrorPasarela extends Error {
  constructor(
    mensaje: string,
    readonly codigo?: string,
  ) {
    super(mensaje);
  }
}

/** Códigos de estado de un cobro push en Nequi (getStatusPayment). */
export function estadoNequi(codigo: string | undefined): EstadoGateway {
  switch (codigo) {
    case '35':
      return 'aprobado';
    case '33':
      return 'pendiente';
    case '10-454':
      return 'expirado';
    default:
      return 'rechazado';
  }
}

/**
 * Nequi Conecta: cobros con notificación push (el cliente acepta el pago en su app Nequi).
 * Autenticación OAuth2 client_credentials + x-api-key; mensajes con el formato RequestMessage.
 * Credenciales y URLs en .env (NEQUI_CLIENT_ID, NEQUI_CLIENT_SECRET, NEQUI_API_KEY…).
 */
export class NequiConectaGateway implements PaymentGatewayPort {
  readonly nombre = 'Nequi Conecta';
  private token: { valor: string; vence: number } | null = null;

  constructor(
    private readonly c: ConfigNequi,
    private readonly http: Fetch = (...a) => fetch(...a),
    private readonly ahora: () => number = Date.now,
  ) {}

  async solicitarCobro(d: { telefono: string; monto: number; referencia: string }): Promise<{ transaccionId: string }> {
    const r = await this.llamar('/payments/v2/-services-paymentservice-unregisteredpayment', 'PaymentsService', 'unregisteredPayment', {
      unregisteredPaymentRQ: {
        phoneNumber: d.telefono,
        code: this.c.codigoComercio,
        value: String(Math.round(d.monto)),
        reference1: d.referencia,
        reference2: 'TrackIt Express',
        reference3: 'Envio',
      },
    });
    const id = (r as { unregisteredPaymentRS?: { transactionId?: string } }).unregisteredPaymentRS?.transactionId;
    if (!id) throw new ErrorPasarela('Nequi no devolvió el número de la transacción');
    return { transaccionId: String(id).trim() };
  }

  async consultarEstado(transaccionId: string): Promise<{ estado: EstadoGateway; mensaje?: string }> {
    const r = await this.llamar('/payments/v2/-services-paymentservice-getstatuspayment', 'PaymentsService', 'getStatusPayment', {
      getStatusPaymentRQ: { codeQR: transaccionId },
    });
    const status = (r as { getStatusPaymentRS?: { status?: string } }).getStatusPaymentRS?.status;
    return { estado: estadoNequi(status) };
  }

  async reembolsar(d: { telefono: string; monto: number; transaccionId: string }): Promise<void> {
    await this.llamar('/payments/v2/-services-reverseservices-reversetransaction', 'ReverseServices', 'reverseTransaction', {
      reversionRQ: {
        phoneNumber: d.telefono,
        value: String(Math.round(d.monto)),
        code: this.c.codigoComercio,
        messageId: d.transaccionId,
        type: 'payment',
      },
    });
  }

  private async llamar(ruta: string, servicio: string, operacion: string, cuerpo: unknown): Promise<unknown> {
    const token = await this.tokenAcceso();
    const mensaje = {
      RequestMessage: {
        RequestHeader: {
          Channel: 'PNP04-C001',
          RequestDate: new Date(this.ahora()).toISOString(),
          MessageID: randomBytes(5).toString('hex').slice(0, 10),
          ClientID: this.c.clientId.slice(0, 10) || '12345',
          Destination: { ServiceName: servicio, ServiceOperation: operacion, ServiceRegion: 'C001', ServiceVersion: '1.2.0' },
        },
        RequestBody: { any: cuerpo },
      },
    };
    const r = await this.http(`${this.c.apiUrl}${ruta}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'x-api-key': this.c.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(mensaje),
    });
    const datos = (await r.json().catch(() => null)) as {
      ResponseMessage?: { ResponseHeader?: { Status?: { StatusCode?: string; StatusDesc?: string } }; ResponseBody?: { any?: unknown } };
    } | null;
    const status = datos?.ResponseMessage?.ResponseHeader?.Status;
    if (!r.ok || !status || status.StatusCode !== '0') {
      log.warn(`Nequi ${operacion}: HTTP ${r.status} · ${status?.StatusCode ?? '-'} ${status?.StatusDesc ?? ''}`);
      throw new ErrorPasarela(status?.StatusDesc || 'Nequi no pudo procesar la solicitud', status?.StatusCode);
    }
    return datos?.ResponseMessage?.ResponseBody?.any ?? {};
  }

  private async tokenAcceso(): Promise<string> {
    if (this.token && this.token.vence > this.ahora() + 30_000) return this.token.valor;
    const basico = Buffer.from(`${this.c.clientId}:${this.c.clientSecret}`).toString('base64');
    const r = await this.http(`${this.c.authUrl}?grant_type=client_credentials`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basico}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    });
    if (!r.ok) throw new ErrorPasarela(`No se pudo autenticar con Nequi (HTTP ${r.status})`);
    const d = (await r.json()) as { access_token: string; expires_in?: number };
    this.token = { valor: d.access_token, vence: this.ahora() + (d.expires_in ?? 3600) * 1000 };
    return d.access_token;
  }
}

/**
 * Nequi simulado para desarrollo y pruebas: no mueve dinero. El cobro se aprueba solo a los
 * pocos segundos, salvo con estos celulares de prueba:
 *   - terminado en 0000 → rechazado (el cliente no aceptó)
 *   - terminado en 9999 → expirado (nunca respondió)
 *   - 3000000000       → falla al solicitar (Nequi no disponible)
 */
export class NequiSimuladoGateway implements PaymentGatewayPort {
  readonly nombre = 'Nequi (simulado)';
  private readonly cobros = new Map<string, { telefono: string; creado: number; reembolsado: boolean }>();

  constructor(
    private readonly aprobacionMs: number,
    private readonly ahora: () => number = Date.now,
  ) {}

  async solicitarCobro(d: { telefono: string; monto: number; referencia: string }): Promise<{ transaccionId: string }> {
    if (d.telefono === '3000000000') throw new ErrorPasarela('El servicio de Nequi no está disponible en este momento', '20-07A');
    const id = `SIM-${randomBytes(6).toString('hex').toUpperCase()}`;
    this.cobros.set(id, { telefono: d.telefono, creado: this.ahora(), reembolsado: false });
    log.info(`[Simulado] Cobro ${id} por $${d.monto} enviado al celular ***${d.telefono.slice(-4)}`);
    return { transaccionId: id };
  }

  async consultarEstado(transaccionId: string): Promise<{ estado: EstadoGateway; mensaje?: string }> {
    const c = this.cobros.get(transaccionId);
    if (!c) return { estado: 'rechazado', mensaje: 'Transacción no encontrada' };
    if (c.telefono.endsWith('0000')) return { estado: 'rechazado', mensaje: 'El cliente rechazó el pago en la app Nequi' };
    if (c.telefono.endsWith('9999')) return { estado: this.ahora() - c.creado > this.aprobacionMs ? 'expirado' : 'pendiente' };
    return { estado: this.ahora() - c.creado >= this.aprobacionMs ? 'aprobado' : 'pendiente' };
  }

  async reembolsar(d: { telefono: string; monto: number; transaccionId: string }): Promise<void> {
    const c = this.cobros.get(d.transaccionId);
    if (c) c.reembolsado = true;
    log.info(`[Simulado] Reembolso de $${d.monto} al celular ***${d.telefono.slice(-4)}`);
  }
}
