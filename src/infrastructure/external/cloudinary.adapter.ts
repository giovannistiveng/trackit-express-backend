import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { ArchivoSubido, StoragePort } from '../../domain/ports/storage.port';

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/** Almacenamiento en Cloudinary (imágenes y PDF). */
export class CloudinaryStorage implements StoragePort {
  constructor(cfg: CloudinaryConfig) {
    cloudinary.config({ cloud_name: cfg.cloudName, api_key: cfg.apiKey, api_secret: cfg.apiSecret, secure: true });
  }

  upload(archivo: ArchivoSubido, carpeta: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: carpeta, resource_type: archivo.mimetype === 'application/pdf' ? 'raw' : 'image' },
        (error, result: UploadApiResponse | undefined) => {
          if (result && !error) resolve(result.secure_url);
          // Cloudinary entrega un objeto con message, no un Error: se envuelve (Sonar S6671)
          else reject(new Error(error?.message ?? 'Error subiendo archivo a Cloudinary'));
        },
      );
      stream.end(archivo.buffer);
    });
  }
}

/** true si las credenciales parecen reales (no los valores de ejemplo de .env.example). */
export function cloudinaryConfigurado(cfg: CloudinaryConfig): boolean {
  return [cfg.cloudName, cfg.apiKey, cfg.apiSecret].every((v) => !!v && !v.startsWith("tu_"));
}
