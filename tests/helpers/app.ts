import { readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { Pool } from 'pg';
import request from 'supertest';
import { pool } from '../../src/config/database';
import { config } from '../../src/config';
import { logger } from '../../src/shared/logger';
import { crearContenedor } from '../../src/infrastructure/container';
import { crearApp } from '../../src/infrastructure/http/app';
import { LocalDiskStorage } from '../../src/infrastructure/external/local-disk.storage';
import { DistancePort, GeocodingPort } from '../../src/domain/repositories/services.port';
import { CorreoSaliente, EstadoGateway, MailerPort, PaymentGatewayPort, PushSenderPort } from '../../src/domain/repositories/platform.ports';

export const DIR_UPLOADS = path.join(os.tmpdir(), 'trackit-test-uploads');

/** Coordenadas reales de Fusagasugá (origen) y Silvania (destino). */
export const FUSA = { lat: 4.3369, lon: -74.3638 };
export const SILVANIA = { lat: 4.4033, lon: -74.3878 };

/** 12:00 en Colombia: sin recargo nocturno. */
export const MEDIODIA = new Date('2026-10-29T17:00:00Z');

/** Búsqueda de direcciones fija: las pruebas no dependen de Nominatim. */
export const geocodificadorFijo: GeocodingPort = {
  buscar: async (q: string) => (/silvania/i.test(q) ? [{ nombre: 'Silvania', detalle: 'Silvania, Cundinamarca', coords: SILVANIA }] : []),
  inversa: async (p) => ({ nombre: 'Parque principal, Fusagasugá', detalle: 'Fusagasugá', coords: p }),
};

/** Distancia fija: las pruebas no dependen de OpenStreetMap. */
export const distanciaFija: DistancePort = {
  calcularDistancia: async (_o, _d, conocidos = {}) => ({
    distancia_km: 34.5,
    duracion_segundos: 4140,
    origen: conocidos.origen ?? FUSA,
    destino: conocidos.destino ?? SILVANIA,
    exacta: true,
  }),
};

/** ¿Hay una base de datos de pruebas disponible? */
export async function hayBaseDeDatos(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** Borra y recrea el esquema de la base de pruebas. Se niega si el nombre no contiene "test". */
export async function reiniciarBase(p: Pool = pool): Promise<void> {
  const nombre = config.db.url ? new URL(config.db.url).pathname.slice(1) : config.db.database;
  if (!/test/i.test(nombre)) throw new Error(`Por seguridad, las pruebas solo borran bases cuyo nombre contiene "test" (actual: ${nombre})`);
  const dir = path.resolve(__dirname, '..', '..', 'database');
  await p.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await p.query(readFileSync(path.join(dir, 'schema.sql'), 'utf8'));
  await p.query(readFileSync(path.join(dir, 'seed.sql'), 'utf8'));
}

/** Buzón de correo en memoria: las pruebas leen los enlaces de verificación y recuperación. */
export class BuzonPrueba implements MailerPort {
  readonly correos: CorreoSaliente[] = [];
  async enviar(c: CorreoSaliente) {
    this.correos.push(c);
  }
  /** Último enlace enviado a un correo. */
  enlace(para: string): string {
    const c = [...this.correos].reverse().find((x) => x.para === para);
    return /https?:\/\/[^\s]+/.exec(c?.texto ?? '')?.[0] ?? '';
  }
  token(para: string): string {
    return new URL(this.enlace(para)).searchParams.get('token') ?? '';
  }
}

/** Pasarela Nequi de prueba controlable: cada cobro queda en el estado que indique la prueba. */
export class NequiPrueba implements PaymentGatewayPort {
  readonly nombre = 'Nequi (pruebas)';
  estado: EstadoGateway = 'pendiente';
  fallarCobro = false;
  fallarReembolso = false;
  readonly cobros: { telefono: string; monto: number; referencia: string }[] = [];
  readonly reembolsos: string[] = [];
  async solicitarCobro(d: { telefono: string; monto: number; referencia: string }) {
    if (this.fallarCobro) throw new Error('Nequi no disponible');
    this.cobros.push(d);
    return { transaccionId: `T-${this.cobros.length}` };
  }
  async consultarEstado() {
    return { estado: this.estado };
  }
  async reembolsar(d: { transaccionId: string }) {
    if (this.fallarReembolso) throw new Error('Reverso no disponible');
    this.reembolsos.push(d.transaccionId);
  }
}

export const buzon = new BuzonPrueba();
export const nequi = new NequiPrueba();
export const pushEnviados: { endpoint: string; titulo: string }[] = [];
const pushPrueba: PushSenderPort = {
  plataformas: ['web', 'android', 'ios'],
  enviar: async (s, m) => {
    pushEnviados.push({ endpoint: s.endpoint, titulo: m.titulo });
    return !s.endpoint.includes('vencido');
  },
};

export function crearContenedorPrueba(reloj: () => Date = () => MEDIODIA) {
  return crearContenedor({
    pool,
    log: logger,
    distancia: distanciaFija,
    geocodificador: geocodificadorFijo,
    reloj,
    storage: new LocalDiskStorage(DIR_UPLOADS, 'http://localhost:3000'),
    mailer: buzon,
    pasarela: nequi,
    pushSenders: [pushPrueba],
  });
}

export function crearAppPrueba(contenedor = crearContenedorPrueba()) {
  return crearApp({ contenedor, log: logger, salud: async () => (await pool.query('SELECT 1'), true) });
}

export type Agente = ReturnType<typeof request>;

/** Registra (si hace falta) e inicia sesión; devuelve el token y el id del usuario. */
export async function sesion(app: Parameters<typeof request>[0], correo: string, rol: 2 | 3, nombre = 'Usuario Prueba') {
  await request(app).post('/api/auth/register').send({ nombre, correo, password: 'Clave1234', id_rol: rol });
  const r = await request(app).post('/api/auth/login').send({ correo, password: 'Clave1234' });
  return { token: r.body.token as string, id: r.body.user.id as number };
}

export async function sesionAdmin(app: Parameters<typeof request>[0]) {
  const r = await request(app).post('/api/auth/login').send({ correo: 'admin@trackit.com.co', password: 'Admin2026*' });
  return { token: r.body.token as string, id: r.body.user.id as number };
}
