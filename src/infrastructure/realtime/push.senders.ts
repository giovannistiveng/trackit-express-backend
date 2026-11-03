import { existsSync, readFileSync, writeFileSync } from 'fs';
import jwt from 'jsonwebtoken';
import webpush from 'web-push';
import { MensajePush, PlataformaPush, PushSenderPort, SuscripcionPush } from '../../domain/repositories/platform.ports';
import { logger } from '../../shared/logger';

const log = logger.child('Push');

export interface ClavesVapid {
  publica: string;
  privada: string;
}

/**
 * Claves VAPID: las de .env o, si faltan, unas generadas una sola vez y guardadas en
 * `archivo` para que las suscripciones sigan sirviendo después de reiniciar.
 */
export function clavesVapid(publica: string, privada: string, archivo = '.vapid.json'): ClavesVapid {
  if (publica && privada) return { publica, privada };
  try {
    if (existsSync(archivo)) {
      const k = JSON.parse(readFileSync(archivo, 'utf8')) as ClavesVapid;
      if (k.publica && k.privada) return k;
    }
  } catch {
    // Archivo dañado: se regenera
  }
  const g = webpush.generateVAPIDKeys();
  const k = { publica: g.publicKey, privada: g.privateKey };
  try {
    writeFileSync(archivo, JSON.stringify(k, null, 2));
    log.warn(`Claves VAPID generadas en ${archivo}. Para producción cópialas a VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY.`);
  } catch {
    log.warn('No se pudieron guardar las claves VAPID; las suscripciones se perderán al reiniciar.');
  }
  return k;
}

/** Contenido que entiende el service worker de Angular (ngsw) para mostrar y abrir la notificación. */
export function cargaAngular(m: MensajePush) {
  return {
    notification: {
      title: m.titulo,
      body: m.cuerpo,
      icon: 'icons/icon-192x192.png',
      badge: 'icons/icon-72x72.png',
      tag: m.etiqueta,
      renotify: !!m.etiqueta,
      data: {
        url: m.url,
        onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: m.url } },
      },
    },
  };
}

type EnviarWebPush = (s: webpush.PushSubscription, carga: string, o: webpush.RequestOptions) => Promise<unknown>;

/** Notificaciones del navegador (Chrome, Edge, Firefox, Safari 16+) con el estándar Web Push. */
export class WebPushSender implements PushSenderPort {
  readonly plataformas: PlataformaPush[] = ['web'];

  constructor(
    private readonly claves: ClavesVapid,
    private readonly contacto: string,
    private readonly enviarNotificacion: EnviarWebPush = (s, c, o) => webpush.sendNotification(s, c, o),
  ) {}

  async enviar(s: SuscripcionPush, m: MensajePush): Promise<boolean> {
    try {
      await this.enviarNotificacion(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh ?? '', auth: s.auth ?? '' } },
        JSON.stringify(cargaAngular(m)),
        { TTL: 3600, vapidDetails: { subject: this.contacto, publicKey: this.claves.publica, privateKey: this.claves.privada } },
      );
      return true;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // 404/410: el navegador anuló la suscripción
      if (status === 404 || status === 410) return false;
      log.warn(`No se pudo enviar la notificación web (${status ?? 'sin respuesta'})`);
      return true;
    }
  }
}

interface CuentaServicio {
  project_id: string;
  client_email: string;
  private_key: string;
}

type Fetch = typeof fetch;

/**
 * Notificaciones a la app móvil (Android/iOS empaquetada con Capacitor) con Firebase Cloud
 * Messaging HTTP v1. Se autentica con la cuenta de servicio (JWT RS256 → token OAuth2).
 */
export class FcmSender implements PushSenderPort {
  readonly plataformas: PlataformaPush[] = ['android', 'ios'];
  private token: { valor: string; vence: number } | null = null;

  constructor(
    private readonly cuenta: CuentaServicio,
    private readonly http: Fetch = (...a) => fetch(...a),
    private readonly ahora: () => number = Date.now,
  ) {}

  static desdeArchivo(ruta: string): FcmSender | null {
    if (!ruta) return null;
    try {
      return new FcmSender(JSON.parse(readFileSync(ruta, 'utf8')) as CuentaServicio);
    } catch (e) {
      log.error(`No se pudo leer la cuenta de servicio de Firebase (${ruta})`, e);
      return null;
    }
  }

  async enviar(s: SuscripcionPush, m: MensajePush): Promise<boolean> {
    const token = await this.tokenAcceso();
    const r = await this.http(`https://fcm.googleapis.com/v1/projects/${this.cuenta.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: s.endpoint,
          notification: { title: m.titulo, body: m.cuerpo },
          data: { url: m.url },
          android: { priority: 'HIGH', notification: { channel_id: 'trackit', tag: m.etiqueta } },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      }),
    });
    if (r.status === 404 || r.status === 400) return false; // token de dispositivo inválido o vencido
    if (!r.ok) log.warn(`FCM respondió ${r.status}`);
    return true;
  }

  private async tokenAcceso(): Promise<string> {
    if (this.token && this.token.vence > this.ahora() + 60_000) return this.token.valor;
    const ahoraSeg = Math.floor(this.ahora() / 1000);
    const asercion = jwt.sign(
      { iss: this.cuenta.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: ahoraSeg, exp: ahoraSeg + 3600 },
      this.cuenta.private_key,
      { algorithm: 'RS256' },
    );
    const r = await this.http('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: asercion }).toString(),
    });
    if (!r.ok) throw new Error(`Firebase rechazó la cuenta de servicio (${r.status})`);
    const d = (await r.json()) as { access_token: string; expires_in: number };
    this.token = { valor: d.access_token, vence: this.ahora() + d.expires_in * 1000 };
    return d.access_token;
  }
}
