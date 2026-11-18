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
import { DistancePort, GeocodingPort, RoutePort } from '../../src/domain/ports/services.port';
import { CorreoSaliente, EstadoGateway, MailerPort, PaymentGatewayPort, PushSenderPort } from '../../src/domain/ports/platform.ports';

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

/** Ruta fija para el mapa: une los puntos pedidos. */
export const rutaFija: RoutePort = {
  trazarRuta: async (puntos) => ({ km: 34.5, minutos: 69, puntos, exacta: true }),
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
/**
 * Comprueba la base de pruebas. Si PostgreSQL responde pero la base aún no existe (código 3D000),
 * la crea; así `npm test` funciona en un equipo nuevo sin pasos manuales.
 */
export async function hayBaseDeDatos(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === '3D000' && !config.db.url && (await crearBasePruebas())) {
      return hayBaseDeDatos();
    }
    avisarSinBase(e);
    return false;
  }
}

async function crearBasePruebas(): Promise<boolean> {
  const nombre = config.db.database;
  if (!/test/i.test(nombre) || !/^\w+$/.test(nombre)) return false;
  const admin = new Pool({ ...config.db, database: 'postgres' });
  try {
    await admin.query(`CREATE DATABASE ${nombre}`);
    return true;
  } catch {
    return false;
  } finally {
    await admin.end();
  }
}

let avisado = false;
function avisarSinBase(e: unknown): void {
  if (avisado) return;
  avisado = true;
  console.warn(
    `⚠ Sin PostgreSQL de pruebas (${(e as Error).message}): se omiten las pruebas de integración y la cobertura ` +
      'baja. Revisa DB_HOST, DB_USER y DB_PASSWORD en .env o define TEST_DATABASE_URL.',
  );
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
    rutas: rutaFija,
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

const FOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

/** Fecha de vencimiento válida para las pruebas: dentro de un año. */
export const UN_ANO = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

/** Sube los documentos obligatorios del conductor (con vencimiento donde aplica). */
export async function subirRequisitos(app: Parameters<typeof request>[0], token: string) {
  for (const tipo of ['Cédula', 'Selfie', 'Licencia', 'SOAT', 'Tarjeta de propiedad', 'Antecedentes']) {
    const r = request(app).post('/api/documentos/upload').set({ Authorization: `Bearer ${token}` }).field('tipo_documento', tipo);
    if (tipo === 'Licencia' || tipo === 'SOAT') r.field('fecha_vencimiento', UN_ANO);
    await r.attach('archivo', FOTO, { filename: 'doc.jpg', contentType: 'image/jpeg' });
  }
}

/** Documentos subidos, revisados uno por uno y conductor aprobado (requiere vehículo registrado). */
export async function aprobarConductor(app: Parameters<typeof request>[0], tokenConductor: string, tokenAdmin: string, idConductor: number) {
  const admin = { Authorization: `Bearer ${tokenAdmin}` };
  await subirRequisitos(app, tokenConductor);
  const lista = (await request(app).get('/api/conductores/pendientes').set(admin)).body as { id_conductor: number; documentos: { id: number }[] }[];
  const yo = lista.find((c) => c.id_conductor === idConductor);
  for (const d of yo?.documentos ?? []) await request(app).patch(`/api/admin/documentos/${d.id}`).set(admin).send({ aprobado: true });
  return request(app).post('/api/conductores/aprobar').set(admin).send({ driverId: idConductor, approved: true });
}

