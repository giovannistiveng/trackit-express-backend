import { Actor, ROLES } from '../../../domain/entities/actor.entity';
import { AuditRepositoryPort } from '../../../domain/repositories/audit.repository.port';
import { MetricsRepositoryPort } from '../../../domain/repositories/metrics.repository.port';
import { exigirRol } from '../../services/access';

/** E7-HU2: métricas del panel administrativo. */
export class GetDashboardMetricsUseCase {
  constructor(private readonly metricas: MetricsRepositoryPort) {}

  execute(actor: Actor) {
    exigirRol(actor, ROLES.ADMIN);
    return this.metricas.dashboard();
  }
}

/** E7-HU2: auditoría paginada con filtros. */
export class SearchAuditUseCase {
  constructor(private readonly auditoria: AuditRepositoryPort) {}

  async execute(actor: Actor, q: { pagina?: unknown; tamano?: unknown; texto?: unknown; accion?: unknown }) {
    exigirRol(actor, ROLES.ADMIN);
    const pagina = Math.max(1, Number.parseInt(String(q.pagina ?? '1'), 10) || 1);
    const tamano = Math.min(1000, Math.max(1, Number.parseInt(String(q.tamano ?? '15'), 10) || 15));
    const texto = typeof q.texto === 'string' && q.texto.trim() ? q.texto.trim().slice(0, 100) : undefined;
    const accion = typeof q.accion === 'string' && q.accion.trim() ? q.accion.trim() : undefined;
    const { items, total } = await this.auditoria.search({ pagina, tamano, texto, accion });
    return {
      items: items.map((r) => ({
        id: r.id as number,
        fecha: (r.fecha ?? new Date()).toISOString(),
        usuario: r.correo_usuario ?? 'Sistema',
        accion: r.accion,
        entidad: r.entidad,
        detalle: r.detalle ?? '',
      })),
      total,
      pagina,
      tamano,
    };
  }
}
