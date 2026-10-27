import { Pool } from 'pg';
import { config } from './index';

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
});

export async function testConnection(): Promise<void> {
  try {
    const client = await pool.connect();
    console.log('✅ Conectado a PostgreSQL correctamente');
    client.release();
  } catch (error) {
    console.error('❌ Error conectando a PostgreSQL:', error);
    throw error;
  }
}