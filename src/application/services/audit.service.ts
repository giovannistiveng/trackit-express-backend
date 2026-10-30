import { Actor } from '../../domain/entities/actor.entity';
import { AuditRepositoryPort } from '../../domain/repositories/audit.repository.port';

export interface EventoAuditoria {
  accion: string;
  entidad: string;
  idEntidad?: number | null;
  detalle?: string | null;
}

/**
 * Registra acciones relevantes en la tabla Auditoria. Un fallo al auditar nunca
 * interrumpe la operación principal: se informa por el callback de error.
 */
export class AuditService {
  constructor(
    private readonly repo: AuditRepositoryPort,
    private readonly alFallar: (error: unknown) => void = () => undefined,
  ) {}

  async registrar(actor: Pick<Actor, 'userId' | 'email'> | null, evento: EventoAuditoria): Promise<void> {
    try {
      await this.repo.save({
        id_usuario: actor?.userId ?? null,
        correo_usuario: actor?.email ?? null,
        accion: evento.accion,
        entidad: evento.entidad,
        id_entidad: evento.idEntidad ?? null,
        detalle: evento.detalle ? evento.detalle.slice(0, 500) : null,
      });
    } catch (error) {
      this.alFallar(error);
    }
  }
}
