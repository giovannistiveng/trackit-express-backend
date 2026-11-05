/**
 * Comandos de base de datos (usan la misma configuración que el servidor: .env).
 *
 *   npm run db:setup      Crea las tablas y carga los datos iniciales (base nueva)
 *   npm run db:migrate    Aplica las migraciones pendientes
 *   node dist/infrastructure/database/cli.js preparar   (Docker: crea o actualiza según el caso)
 */
import { pool } from '../../config/database';
import { Migrador } from './migrador';

const migrador = new Migrador(pool);
const acciones: Record<string, () => Promise<unknown>> = {
  setup: () => migrador.setup(),
  migrate: () => migrador.migrate(),
  preparar: () => migrador.preparar(),
};

async function main(comando = process.argv[2]): Promise<void> {
  const accion = acciones[comando];
  if (!accion) {
    console.error('Uso: cli <setup|migrate|preparar>');
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
}

void main();
