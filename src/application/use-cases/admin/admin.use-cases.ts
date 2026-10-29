import { Actor, ROLES } from '../../../domain/entities/actor.entity';
import { AuditRepositoryPort } from '../../../domain/repositories/audit.repository.port';
import { MetricsRepositoryPort } from '../../../domain/repositories/metrics.repository.port';
import { ContactRepositoryPort } from '../../../domain/repositories/contact.repository.port';
import { ShipmentRepositoryPort } from '../../../domain/repositories/shipment.repository.port';
import { ZonaTarifaRepositoryPort } from '../../../domain/repositories/zona-tarifa.repository.port';
import { ESTADOS_ENVIO, EstadoEnvio } from '../../../domain/entities/shipment.entity';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import { AuditService } from '../../services/audit.service';
import { presentarEnvio } from '../../services/envio.presenter';
import { exigirRol } from '../../services/access';
import { idValido } from '../../validation';

function paginacion(q: { pagina?: unknown; tamano?: unknown }, porDefecto = 15, maximo = 100) {
  const pagina = Math.max(1, Number.parseInt(String(q.pagina ?? '1'), 10) || 1);
  const tamano = Math.min(maximo, Math.max(1, Number.parseInt(String(q.tamano ?? porDefecto), 10) || porDefecto));
  return { pagina, tamano };
}

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

/** Todos los envíos, con filtros por estado, zona y texto (id, direcciones, cliente o conductor). */
export class SearchShipmentsAdminUseCase {
  constructor(private readonly envios: ShipmentRepositoryPort) {}

  async execute(actor: Actor, q: { pagina?: unknown; tamano?: unknown; estado?: unknown; id_zona?: unknown; texto?: unknown }) {
    exigirRol(actor, ROLES.ADMIN);
    const { pagina, tamano } = paginacion(q);
    let estado: EstadoEnvio | undefined;
    if (typeof q.estado === 'string' && q.estado !== '') {
      if (!(ESTADOS_ENVIO as readonly string[]).includes(q.estado)) throw new ValidationError('Filtro de estado inválido');
      estado = q.estado as EstadoEnvio;
    }
    const id_zona = q.id_zona === undefined || q.id_zona === '' ? undefined : idValido(q.id_zona, 'id_zona');
    const texto = typeof q.texto === 'string' && q.texto.trim() ? q.texto.trim().slice(0, 100) : undefined;
    const { items, total } = await this.envios.searchAdmin({ estado, id_zona, texto, pagina, tamano });
    return {
      total,
      pagina,
      tamano,
      items: items.map((e) => ({
        ...presentarEnvio(e, { incluirPin: false }),
        fecha_ultimo_cambio: e.fecha_ultimo_cambio?.toISOString(),
        cliente: { nombre: e.cliente_nombre, correo: e.cliente_correo },
        conductor_nombre: e.conductor_nombre,
        zona: e.zona_nombre,
      })),
    };
  }
}

/** Cambia la tarifa base de una zona (afecta solo a las cotizaciones nuevas). */
export class UpdateZoneTariffUseCase {
  constructor(
    private readonly zonas: ZonaTarifaRepositoryPort,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, idCrudo: unknown, input: { tarifa_base?: unknown }) {
    exigirRol(actor, ROLES.ADMIN);
    const id = idValido(idCrudo, 'id de la zona');
    const tarifa = Number(input.tarifa_base);
    if (!Number.isFinite(tarifa) || tarifa < 0 || tarifa > 1_000_000) {
      throw new ValidationError('La tarifa base debe ser un valor entre 0 y 1.000.000 COP');
    }
    const anterior = await this.zonas.findById(id);
    if (!anterior) throw new NotFoundError(`No existe la zona de tarifa con id ${id}`);
    const zona = await this.zonas.updateTarifa(id, Math.round(tarifa));
    await this.audit.registrar(actor, {
      accion: 'Tarifa actualizada',
      entidad: 'Zona',
      idEntidad: id,
      detalle: `${anterior.nombre_zona}: ${anterior.tarifa_base} → ${Math.round(tarifa)}`,
    });
    return zona;
  }
}

/** Mensajes del formulario de contacto. */
export class ListContactsUseCase {
  constructor(private readonly repo: ContactRepositoryPort) {}

  async execute(actor: Actor, q: { pagina?: unknown; tamano?: unknown; pendientes?: unknown }) {
    exigirRol(actor, ROLES.ADMIN);
    const { pagina, tamano } = paginacion(q);
    const { items, total } = await this.repo.search({ pagina, tamano, pendientes: q.pendientes === 'true' });
    return {
      total,
      pagina,
      tamano,
      items: items.map((m) => ({ ...m, fecha: (m.fecha ?? new Date()).toISOString() })),
    };
  }
}

export class ResolveContactUseCase {
  constructor(
    private readonly repo: ContactRepositoryPort,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, idCrudo: unknown): Promise<void> {
    exigirRol(actor, ROLES.ADMIN);
    const id = idValido(idCrudo, 'id del mensaje');
    if (!(await this.repo.markAttended(id))) throw new NotFoundError('No existe ese mensaje');
    await this.audit.registrar(actor, { accion: 'Contacto atendido', entidad: 'Contacto', idEntidad: id });
  }
}
