import { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { AppError } from '../../../shared/errors';
import { Logger } from '../../../shared/logger';

const MENSAJES_MULTER: Record<string, string> = {
  LIMIT_FILE_SIZE: 'El archivo supera el tamaño máximo de 5 MB',
  LIMIT_FILE_COUNT: 'Solo se permite un archivo',
  LIMIT_UNEXPECTED_FILE: 'El archivo debe enviarse en el campo "archivo"',
};

/** Convierte cualquier error en { error, statusCode } y registra los 5xx con su stack. */
export function manejarErrores(log: Logger) {
  // Express reconoce el manejador de errores por sus 4 parámetros
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const donde = `${req.method} ${req.originalUrl} id=${req.requestId ?? '-'}`;
    let status = 500;
    let mensaje = 'Error interno del servidor';

    if (err instanceof AppError) {
      status = err.statusCode;
      mensaje = err.message;
    } else if (err instanceof multer.MulterError) {
      status = 400;
      mensaje = MENSAJES_MULTER[err.code] ?? 'Error al procesar el archivo';
    } else if (err instanceof SyntaxError && (err as { type?: string }).type === 'entity.parse.failed') {
      status = 400;
      mensaje = 'El cuerpo de la petición no es un JSON válido';
    } else if ((err as { type?: string })?.type === 'entity.too.large') {
      status = 413;
      mensaje = 'El cuerpo de la petición es demasiado grande';
    }

    if (status >= 500) log.error(`${donde} → ${status} Error no controlado`, err);
    else log.warn(`${donde} → ${status} ${mensaje}`);
    res.status(status).json({ error: mensaje, statusCode: status });
  };
}

/** 404 para rutas de la API que no existen. */
export function rutaNoEncontrada(req: Request, res: Response): void {
  res.status(404).json({ error: `No existe la ruta ${req.method} ${req.path}`, statusCode: 404 });
}
