export interface User {
  id?: number;
  nombre: string;
  correo: string;
  password_hash: string;
  id_rol: number;
  telefono?: string | null;
  fecha_registro?: Date;
}
