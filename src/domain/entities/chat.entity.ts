export interface MensajeChat {
  id_mensaje?: number;
  id_envio: number;
  id_usuario: number;
  autor_nombre?: string;
  texto: string;
  leido?: boolean;
  creado?: Date;
}

export const LARGO_MAXIMO_MENSAJE = 500;
