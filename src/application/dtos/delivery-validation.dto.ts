export interface DeliveryValidationDTO {
  id_envio: number;
  url_foto: string; // URL de la foto subida a Cloudinary
  pin_seguridad?: string; // PIN de validación del cliente (opcional)
}