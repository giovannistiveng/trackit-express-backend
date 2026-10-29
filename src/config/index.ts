import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    /** Si existe (Render, Railway, Heroku), tiene prioridad sobre los campos sueltos. */
    url: process.env.DATABASE_URL || '',
    ssl: (process.env.DB_SSL || 'false').toLowerCase() === 'true',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'trackit_express',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'default_secret_change_in_production',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  bcrypt: {
    saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10),
  },
  /** URL pública del backend (para construir enlaces a archivos guardados en disco). */
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || '3000'}`).replace(/\/$/, ''),
  /** Orígenes permitidos por CORS, separados por coma. Vacío = cualquiera (solo desarrollo). */
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
  uploadsDir: process.env.UPLOADS_DIR || 'uploads',
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  log: {
    dir: process.env.LOG_DIR || 'logs',
    level: (process.env.LOG_LEVEL || '').toUpperCase(),
    retentionDays: parseInt(process.env.LOG_RETENTION_DAYS || '30', 10),
    toConsole: (process.env.LOG_TO_CONSOLE || 'true').toLowerCase() !== 'false',
  },
};