import express from 'express';
import cors from 'cors';
import { config } from '../../config';
import { pool, testConnection } from '../../config/database';
import { AppError } from '../../shared/errors';

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Ruta de salud
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'TrackIt Express Backend está funcionando' });
});

// Middleware de manejo de errores
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, statusCode: err.statusCode });
  }
  console.error(err);
  return res.status(500).json({ error: 'Error interno del servidor' });
});

// Iniciar servidor
async function start() {
  try {
    await testConnection();
    app.listen(config.port, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${config.port}`);
    });
  } catch (error) {
    console.error('❌ Error iniciando el servidor:', error);
    process.exit(1);
  }
}

start();

export default app;