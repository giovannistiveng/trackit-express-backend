import multer from 'multer';
import { ValidationError } from '../../../shared/errors';

export const MAX_ARCHIVO_BYTES = 5 * 1024 * 1024;

/** multer en memoria: un archivo en el campo "archivo", tipos permitidos y 5 MB como máximo. */
export function subirArchivo(tipos: string[]) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ARCHIVO_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (tipos.includes(file.mimetype)) cb(null, true);
      else cb(new ValidationError(tipos.includes('application/pdf') ? 'Solo se permiten imágenes o PDF' : 'La foto debe ser JPG o PNG'));
    },
  }).single('archivo');
}
