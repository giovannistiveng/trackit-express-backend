// Entorno de pruebas: sin consola ni límites de peticiones, logs en una carpeta temporal.
import os from 'os';
import path from 'path';

process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_DISABLED = 'true';
process.env.LOG_TO_CONSOLE = 'false';
process.env.LOG_DIR = process.env.LOG_DIR_TEST || path.join(os.tmpdir(), 'trackit-test-logs');
process.env.JWT_SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';
// Base de datos de pruebas (se borra y se recrea): nunca la de desarrollo
process.env.DB_NAME = process.env.TEST_DB_NAME || 'trackit_test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
