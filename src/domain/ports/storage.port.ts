export interface ArchivoSubido {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

/** Almacenamiento de archivos (Cloudinary en producción, disco local si no está configurado). */
export interface StoragePort {
  /** Guarda el archivo en la carpeta lógica dada y devuelve su URL pública. */
  upload(archivo: ArchivoSubido, carpeta: string): Promise<string>;
}
