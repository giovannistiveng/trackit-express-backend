export const ASUNTOS_CONTACTO = ['General', 'Empresas', 'Conductores', 'Soporte'] as const;
export type AsuntoContacto = (typeof ASUNTOS_CONTACTO)[number];

export interface MensajeContacto {
  id?: number;
  nombre: string;
  correo: string;
  telefono?: string | null;
  asunto: AsuntoContacto;
  mensaje: string;
  atendido?: boolean;
  fecha?: Date;
}
