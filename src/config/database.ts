import { Pool } from 'pg';
import { config } from './index';
import { logger } from '../shared/logger';

const log = logger.child('BaseDatos');

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
});

// Errores de clientes inactivos del pool (por ejemplo, si PostgreSQL se reinicia)
pool.on('error', (err) => {
  log.error('Error inesperado en el pool de PostgreSQL', err);
});

export async function testConnection(): Promise<void> {
  try {
    const client = await pool.connect();
    log.info(`Conectado a PostgreSQL (${config.db.host}:${config.db.port}/${config.db.database})`);
    client.release();
  } catch (error) {
    log.error('Error conectando a PostgreSQL', error);
    throw error;
  }
}