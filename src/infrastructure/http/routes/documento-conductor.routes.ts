import { Router } from 'express';
import multer from 'multer';
import { DocumentoConductorController } from '../controllers/documento-conductor.controller';
import { AppError } from '../../shared/errors';

export function createDocumentoConductorRoutes(controller: DocumentoConductorController): Router {
  const router = Router();

  // Configuración de multer: almacenar en memoria (buffer) para subir a Cloudinary
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB máximo
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
        cb(null, true);
      } else {
        cb(new Error('Solo se permiten imágenes o PDF'));
      }
    },
  });

  router.post('/upload', upload.single('archivo'), async (req, res, next) => {
    try {
      await controller.upload(req, res);
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ error: error.message, statusCode: error.statusCode });
      }
      // Errores de multer (tamaño excedido, tipo inválido, etc.)
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Error al procesar el archivo' });
    }
  });

  return router;
}