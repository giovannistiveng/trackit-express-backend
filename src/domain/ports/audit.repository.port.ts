import { FiltroAuditoria, RegistroAuditoria } from '../entities/auditoria.entity';

export interface AuditRepositoryPort {
  save(registro: RegistroAuditoria): Promise<void>;
  search(filtro: FiltroAuditoria): Promise<{ items: RegistroAuditoria[]; total: number }>;
}
