import { MensajeContacto } from '../entities/contacto.entity';

export interface ContactRepositoryPort {
  save(m: MensajeContacto): Promise<MensajeContacto>;
  search(f: { pagina: number; tamano: number; pendientes: boolean }): Promise<{ items: MensajeContacto[]; total: number }>;
  markAttended(id: number): Promise<boolean>;
}
