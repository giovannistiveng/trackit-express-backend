import { Actor, ROLES } from '../../../domain/entities/actor.entity';
import { AuditRepositoryPort } from '../../../domain/repositories/audit.repository.port';
import { MetricsRepositoryPort } from '../../../domain/repositories/metrics.repository.port';
import { ContactRepositoryPort } from '../../../domain/repositories/contact.repository.port';
import { ShipmentRepositoryPort } from '../../../domain/repositories/shipment.repository.port';
import { DatosZona, ZonaTarifaRepositoryPort } from '../../../domain/repositories/zona-tarifa.repository.port';
import { TarifaVehiculoRepositoryPort } from '../../../domain/repositories/tarifa-vehiculo.repository.port';
import { categoriaOpcional } from '../../services/cotizador';
import { presentarZona } from '../catalog/catalog.use-cases';
import { ESTADOS_ENVIO, EstadoEnvio } from '../../../domain/entities/shipment.entity';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import { AuditService } from '../../services/audit.service';
import { presentarEnvio } from '../../services/envio.presenter';
import { exigirRol } from '../../services/access';
import { coordenadasOpcionales, idValido, numeroEnRango, textoOpcional, textoValido } from '../../validation';

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
export const RECARGO_MAXIMO = 200_000;

/** Valida los campos editables de una zona. Con `parcial`, solo los que vienen en la petición. */
function datosZona(input: Record<string, unknown>, parcial: boolean): Partial<DatosZona> {
  const d: Partial<DatosZona> = {};
  const viene = (k: string) => input[k] !== undefined;
  if (!parcial || viene('nombre_zona')) d.nombre_zona = textoValido(input['nombre_zona'], 'nombre_zona', 2, 100);
  const recargo = viene('recargo') ? input['recargo'] : input['tarifa_base'];
  if (!parcial || recargo !== undefined) {
    const r = Number(recargo ?? 0);
    if (!Number.isFinite(r) || r < 0 || r > RECARGO_MAXIMO) {
      throw new ValidationError('El recargo de la zona debe ser un valor entre 0 y 200.000 COP');
    }
    d.tarifa_base = Math.round(r);
  }
  if (!parcial || viene('centro')) {
    const centro = coordenadasOpcionales(input['centro'], 'centro');
    if (!centro && !parcial) throw new ValidationError('Indica el centro de la zona en el mapa');
    d.centro = centro;
  }
  if (!parcial || viene('radio_km')) d.radio_km = Math.round(numeroEnRango(input['radio_km'] ?? 3, 'radio_km', 0.2, 60) * 100) / 100;
  if (viene('activa')) {
    if (typeof input['activa'] !== 'boolean') throw new ValidationError('El campo "activa" debe ser true o false');
    d.activa = input['activa'];
  }
  if (viene('descripcion')) d.descripcion = textoOpcional(input['descripcion'], 'descripcion', 200);
  return d;
}

/** Todas las zonas, incluidas las desactivadas. */
export class ListZonesAdminUseCase {
  constructor(private readonly zonas: ZonaTarifaRepositoryPort) {}

  async execute(actor: Actor) {
    exigirRol(actor, ROLES.ADMIN);
    return (await this.zonas.findAll(true)).map(presentarZona);
  }
}

/** Crea una zona de cobertura (centro, radio y recargo). */
export class CreateZoneUseCase {
  constructor(
    private readonly zonas: ZonaTarifaRepositoryPort,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, input: Record<string, unknown>) {
    exigirRol(actor, ROLES.ADMIN);
    const datos = datosZona(input, false) as DatosZona;
    const zona = await this.zonas.create({ ...datos, activa: datos.activa ?? true });
    await this.audit.registrar(actor, {
      accion: 'Zona creada',
      entidad: 'Zona',
      idEntidad: zona.id_zona,
      detalle: `${zona.nombre_zona} · radio ${zona.radio_km} km · recargo ${zona.tarifa_base}`,
    });
    return presentarZona(zona);
  }
}

/** Edita una zona: nombre, recargo, centro, radio, descripción o activarla/desactivarla. */
export class UpdateZoneUseCase {
  constructor(
    private readonly zonas: ZonaTarifaRepositoryPort,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, idCrudo: unknown, input: Record<string, unknown>) {
    exigirRol(actor, ROLES.ADMIN);
    const id = idValido(idCrudo, 'id de la zona');
    const cambios = datosZona(input, true);
    if (Object.keys(cambios).length === 0) throw new ValidationError('No hay cambios para guardar');
    const anterior = await this.zonas.findById(id);
    if (!anterior) throw new NotFoundError(`No existe la zona de tarifa con id ${id}`);
    const zona = await this.zonas.update(id, cambios);
    if (!zona) throw new NotFoundError(`No existe la zona de tarifa con id ${id}`);
    const detalle = Object.keys(cambios)
      .map((k) => (k === 'tarifa_base' ? `recargo ${anterior.tarifa_base} → ${zona.tarifa_base}` : k))
      .join(', ');
    await this.audit.registrar(actor, { accion: 'Zona actualizada', entidad: 'Zona', idEntidad: id, detalle: `${zona.nombre_zona}: ${detalle}` });
    return presentarZona(zona);
  }
}

/** @deprecated Se conserva el nombre para PUT /admin/zonas/:id con { tarifa_base }. */
export const UpdateZoneTariffUseCase = UpdateZoneUseCase;

/** Cambia los valores de cobro de un tipo de vehículo. */
export class UpdateVehicleTariffUseCase {
  constructor(
    private readonly tarifas: TarifaVehiculoRepositoryPort,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, categoriaCruda: unknown, input: Record<string, unknown>) {
    exigirRol(actor, ROLES.ADMIN);
    const categoria = categoriaOpcional(categoriaCruda);
    if (!categoria) throw new ValidationError('Indica la categoría del vehículo');
    const t = {
      banderazo: Math.round(numeroEnRango(input['banderazo'], 'banderazo', 0, 200_000)),
      por_km: Math.round(numeroEnRango(input['por_km'], 'por_km', 0, 20_000)),
      por_minuto: Math.round(numeroEnRango(input['por_minuto'], 'por_minuto', 0, 5_000)),
      minimo: Math.round(numeroEnRango(input['minimo'], 'minimo', 0, 500_000)),
    };
    const tarifa = await this.tarifas.update(categoria, t);
    await this.audit.registrar(actor, {
      accion: 'Tarifa de vehículo actualizada',
      entidad: 'Tarifa',
      detalle: `${categoria}: banderazo ${t.banderazo}, km ${t.por_km}, min ${t.por_minuto}, mínimo ${t.minimo}`,
    });
    return tarifa;
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

/** Elimina una zona. Si tiene envíos se archiva (desaparece de todas partes, el historial se conserva). */
export class DeleteZoneUseCase {
  constructor(
    private readonly zonas: ZonaTarifaRepositoryPort,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, idCrudo: unknown): Promise<{ resultado: 'borrada' | 'archivada' }> {
    exigirRol(actor, ROLES.ADMIN);
    const id = idValido(idCrudo, 'id_zona');
    const zona = await this.zonas.findById(id);
    if (!zona) throw new NotFoundError(`No existe la zona de tarifa con id ${id}`);
    const activas = (await this.zonas.findAll()).filter((z) => z.id_zona !== id);
    if (activas.length === 0) throw new ValidationError('No puedes eliminar la única zona activa: sin zonas no hay cobertura');
    const resultado = await this.zonas.remove(id);
    if (!resultado) throw new NotFoundError(`No existe la zona de tarifa con id ${id}`);
    await this.audit.registrar(actor, { accion: 'Zona eliminada', entidad: 'Zona', idEntidad: id, detalle: `${zona.nombre_zona} (${resultado})` });
    return { resultado };
  }
}

export class DeleteContactUseCase {
  constructor(
    private readonly contactos: ContactRepositoryPort,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, idCrudo: unknown): Promise<void> {
    exigirRol(actor, ROLES.ADMIN);
    const id = idValido(idCrudo, 'id del mensaje');
    if (!(await this.contactos.delete(id))) throw new NotFoundError('El mensaje no existe');
    await this.audit.registrar(actor, { accion: 'Mensaje eliminado', entidad: 'Contacto', idEntidad: id });
  }
}
