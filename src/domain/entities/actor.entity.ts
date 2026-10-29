/** Rol tal como está en la tabla Rol (orden del seed). */
export const ROLES = { ADMIN: 1, CLIENTE: 2, CONDUCTOR: 3 } as const;
export type IdRol = (typeof ROLES)[keyof typeof ROLES];

/** Usuario autenticado que ejecuta un caso de uso (sale del JWT). */
export interface Actor {
  userId: number;
  role: number;
  email?: string;
}
