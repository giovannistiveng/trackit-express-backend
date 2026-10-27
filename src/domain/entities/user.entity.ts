export interface User {
  id?: number;
  nombre: string;
  correo: string;
  password_hash: string;
  id_rol: number;
  created_at?: Date;
  updated_at?: Date;
}