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
  /** URL del frontend: se usa en los enlaces de los correos y del seguimiento público. */
  frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:4200').replace(/\/$/, ''),
  correo: {
    /** Sin SMTP_HOST los correos se guardan como archivos en logs/correos (modo desarrollo). */
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: (process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    remitente: process.env.MAIL_FROM || 'TrackIt Express <no-responder@trackit.com.co>',
  },
  push: {
    /** Claves VAPID para notificaciones web. Si faltan, se generan y se guardan en .vapid.json. */
    vapidPublica: process.env.VAPID_PUBLIC_KEY || '',
    vapidPrivada: process.env.VAPID_PRIVATE_KEY || '',
    vapidContacto: process.env.VAPID_SUBJECT || 'mailto:soporte@trackit.com.co',
    /** Dónde guardar las claves generadas (en Docker, dentro de un volumen). */
    vapidArchivo: process.env.VAPID_FILE || '.vapid.json',
    /** Ruta del JSON de la cuenta de servicio de Firebase (app Android/iOS con Capacitor). */
    fcmCuentaServicio: process.env.FCM_SERVICE_ACCOUNT_FILE || '',
  },
  nequi: {
    /** simulado (sin credenciales, para desarrollo) | conecta (API real de Nequi Conecta). */
    modo: (process.env.NEQUI_MODO || 'simulado').toLowerCase(),
    clientId: process.env.NEQUI_CLIENT_ID || '',
    clientSecret: process.env.NEQUI_CLIENT_SECRET || '',
    apiKey: process.env.NEQUI_API_KEY || '',
    authUrl: process.env.NEQUI_AUTH_URL || 'https://oauth.nequi.com/oauth2/token',
    apiUrl: (process.env.NEQUI_API_URL || 'https://api.nequi.com').replace(/\/$/, ''),
    /** Código del comercio asignado por Nequi (NIT_1 en pruebas). */
    codigoComercio: process.env.NEQUI_CODIGO_COMERCIO || 'NIT_1',
    /** Modo simulado: segundos hasta que el cobro se aprueba solo. */
    aprobacionSimuladaSeg: parseInt(process.env.NEQUI_SIMULADO_SEGUNDOS || '8', 10),
  },
  /** Contacto que se envía a Nominatim (OpenStreetMap) en el User-Agent, como exige su política de uso. */
  nominatimContacto: process.env.NOMINATIM_CONTACT || 'soporte@trackit.com.co',
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