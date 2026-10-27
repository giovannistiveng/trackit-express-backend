export interface RegisterUserDTO {
  nombre: string;
  correo: string;
  password: string;
  id_rol: number;
}

export interface LoginDTO {
  correo: string;
  password: string;
}

export interface AuthResponse {
  user: {
    id: number;
    nombre: string;
    correo: string;
    rol: string;
  };
  token: string;
}