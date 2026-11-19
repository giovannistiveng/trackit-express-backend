/**
 * Prepara el backend para las pruebas de carga (npm run carga:preparar):
 *  1. Si no existe carga/.env.carga, lo crea desde .env.carga.example con el usuario, la clave,
 *     el servidor y el puerto de PostgreSQL del .env del backend.
 *  2. Crea la base de carga (DB_NAME, por defecto trackit_carga) si todavía no existe.
 *  3. Crea o actualiza las tablas con el migrador del backend (requiere npm run build antes).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import pg from 'pg';

const raiz = path.resolve(import.meta.dirname, '..');
const envCarga = path.join(raiz, 'carga', '.env.carga');

if (!existsSync(envCarga)) {
  let texto = readFileSync(path.join(raiz, 'carga', '.env.carga.example'), 'utf8');
  const envDesarrollo = path.join(raiz, '.env');
  if (existsSync(envDesarrollo)) {
    const valores = parseEnv(readFileSync(envDesarrollo, 'utf8'));
    for (const clave of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_SSL']) {
      if (valores[clave]) texto = texto.replace(new RegExp(`^${clave}=.*$`, 'm'), () => `${clave}=${valores[clave]}`);
    }
  }
  writeFileSync(envCarga, texto);
  console.log('Creado carga/.env.carga con la conexión de tu .env (revísalo si quieres cambiar algo).');
}

// Igual que node --env-file: lo que ya esté en el entorno tiene prioridad
const env = { ...parseEnv(readFileSync(envCarga, 'utf8')), ...process.env };
const nombre = env.DB_NAME || 'trackit_carga';
if (!/^\w+$/.test(nombre)) throw new Error(`Nombre de base inválido: ${nombre}`);

const cliente = new pg.Client({
  host: env.DB_HOST,
  port: Number(env.DB_PORT || 5432),
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: 'postgres',
  ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});
try {
  await cliente.connect();
  const existe = await cliente.query('SELECT 1 FROM pg_database WHERE datname = $1', [nombre]);
  if (existe.rowCount === 0) {
    await cliente.query(`CREATE DATABASE "${nombre}"`);
    console.log(`Base ${nombre} creada.`);
  }
} catch (error) {
  console.error(
    `No se pudo preparar la base ${nombre} en ${env.DB_HOST}:${env.DB_PORT} con el usuario ${env.DB_USER}: ${error.message}\n` +
      '¿Está encendido PostgreSQL? Revisa DB_USER y DB_PASSWORD en carga/.env.carga.',
  );
  process.exit(1);
} finally {
  await cliente.end().catch(() => undefined);
}

execFileSync(process.execPath, [`--env-file=${envCarga}`, 'dist/infrastructure/database/cli.js', 'preparar'], {
  cwd: raiz,
  stdio: 'inherit',
});
console.log('Listo. Ahora levanta el backend con: npm run carga:servidor');
