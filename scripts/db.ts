/**
 * Administración de la base de datos sin depender de psql (funciona igual en Windows, macOS y Linux).
 *
 *   npm run db:setup     Crea las tablas (schema.sql) y carga los datos iniciales (seed.sql)
 *   npm run db:migrate   Aplica las migraciones pendientes de database/migrations (en orden)
 *
 * Usa la misma configuración que el servidor (.env: DATABASE_URL o DB_HOST, DB_USER, …).
 */
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { pool } from '../src/config/database';

const DIR = path.resolve(__dirname, '..', 'database');

async function ejecutarArchivo(archivo: string): Promise<void> {
  await pool.query(readFileSync(archivo, 'utf8'));
  console.log(`  ✔ ${path.relative(DIR, archivo)}`);
}

async function setup(): Promise<void> {
  console.log('Creando esquema y datos iniciales…');
  await ejecutarArchivo(path.join(DIR, 'schema.sql'));
  await ejecutarArchivo(path.join(DIR, 'seed.sql'));
  // Una base nueva ya tiene todo: se marcan las migraciones como aplicadas
  await registrarTabla();
  for (const m of migraciones()) {
    await pool.query('INSERT INTO schema_migrations (nombre) VALUES ($1) ON CONFLICT DO NOTHING', [m]);
  }
}

async function migrate(): Promise<void> {
  await registrarTabla();
  const aplicadas = new Set((await pool.query<{ nombre: string }>('SELECT nombre FROM schema_migrations')).rows.map((r) => r.nombre));
  const pendientes = migraciones().filter((m) => !aplicadas.has(m));
  if (pendientes.length === 0) {
    console.log('No hay migraciones pendientes.');
    return;
  }
  console.log(`Aplicando ${pendientes.length} migración(es)…`);
  for (const m of pendientes) {
    await ejecutarArchivo(path.join(DIR, 'migrations', m));
    await pool.query('INSERT INTO schema_migrations (nombre) VALUES ($1)', [m]);
  }
  // El seed es idempotente: corrige el administrador sembrado en versiones anteriores
  await ejecutarArchivo(path.join(DIR, 'seed.sql'));
}

function migraciones(): string[] {
  return readdirSync(path.join(DIR, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function registrarTabla(): Promise<void> {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (nombre VARCHAR(200) PRIMARY KEY, aplicada_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  );
}

const comando = process.argv[2];
const acciones: Record<string, () => Promise<void>> = { setup, migrate };

(async () => {
  const accion = acciones[comando];
  if (!accion) {
    console.error('Uso: ts-node scripts/db.ts <setup|migrate>');
    process.exitCode = 1;
    return;
  }
  try {
    await accion();
    console.log('Listo.');
  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
