import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { ArchivoSubido, StoragePort } from '../../domain/repositories/storage.port';

const EXTENSION: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf' };

/**
 * Guarda los archivos en disco y los sirve en /uploads. Se usa cuando Cloudinary
 * no está configurado (desarrollo o servidores con disco persistente).
 */
export class LocalDiskStorage implements StoragePort {
  constructor(
    private readonly directorio: string,
    private readonly urlPublica: string,
  ) {}

  async upload(archivo: ArchivoSubido, carpeta: string): Promise<string> {
    const relativa = carpeta.replace(/[^a-zA-Z0-9/_-]/g, '').replace(/^\/+/, '');
    const nombre = `${Date.now()}-${randomUUID().slice(0, 8)}${EXTENSION[archivo.mimetype] ?? ''}`;
    const destino = path.join(this.directorio, relativa);
    await fs.mkdir(destino, { recursive: true });
    await fs.writeFile(path.join(destino, nombre), archivo.buffer);
    return `${this.urlPublica}/uploads/${relativa}/${nombre}`;
  }
}
