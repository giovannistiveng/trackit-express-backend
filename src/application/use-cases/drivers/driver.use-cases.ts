import { Conductor } from '../../../domain/entities/driver.entity';
import { Actor, ROLES } from '../../../domain/entities/actor.entity';
import { DocumentoConductor, TIPOS_DOCUMENTO } from '../../../domain/entities/documento-conductor.entity';
import {
  CONSULTAS_ADICIONALES,
  DIAS_AVISO_VENCIMIENTO,
  EvaluacionRequisitos,
  REQUISITOS,
  Requisito,
  diasParaVencer,
  evaluarRequisitos,
  fechaVencimientoValida,
  ultimoPorTipo,
  venceEl,
} from '../../../domain/services/verificacion';
import { CATEGORIAS_VEHICULO, VehicleCategory } from '../../../domain/entities/vehicle.entity';
import { DocumentoConductorRepositoryPort } from '../../../domain/ports/documento-conductor.repository.port';
import { DriverRepositoryPort } from '../../../domain/ports/driver.repository.port';
import { ArchivoSubido, StoragePort } from '../../../domain/ports/storage.port';
import { VehicleRepositoryPort } from '../../../domain/ports/vehicle.repository.port';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import { AuditService } from '../../services/audit.service';
import { NotificationService } from '../../services/notification.service';
import { EnvioApi, presentarEnvio } from '../../services/envio.presenter';
import { ShipmentRepositoryPort } from '../../../domain/ports/shipment.repository.port';
import { ESTADOS_ACTIVOS_CONDUCTOR } from '../../../domain/entities/shipment.entity';
import { conductorDelActor, exigirMismoId, exigirRol } from '../../services/access';
import { idValido } from '../../validation';
import { MENSAJE_CATEGORIA } from '../../services/cotizador';

export const TIPOS_ARCHIVO_DOCUMENTO = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const PLACA_RE = /^[A-Z]{3}\d{2}[A-Z0-9]$/;

export function normalizarPlaca(valor: unknown): string {
  return String(valor ?? '').toUpperCase().replace(/[\s-]+/g, '');
}

/** Documento en la respuesta de la API (fechas como texto). */
export function presentarDocumento(d: DocumentoConductor, hoy: Date) {
  const vence = venceEl(d);
  return {
    id: d.id as number,
    tipo_documento: d.tipo_documento,
    url_archivo: d.url_archivo,
    estado: d.estado ?? 'Pendiente',
    motivo_rechazo: d.motivo_rechazo ?? null,
    fecha_subida: d.fecha_subida?.toISOString() ?? null,
    fecha_vencimiento: vence ? vence.toISOString().slice(0, 10) : null,
    dias_para_vencer: diasParaVencer(d, hoy),
  };
}

function presentarRequisitos(ev: EvaluacionRequisitos, hoy: Date) {
  return {
    completo: ev.completo,
    pendientes: ev.pendientes,
    items: ev.items.map((i) => {
      const r = REQUISITOS.find((x) => x.tipo === i.tipo) as Requisito;
      return {
        tipo: i.tipo,
        nombre: i.nombre,
        ayuda: r.ayuda,
        obligatorio: i.obligatorio,
        vence: r.vence,
        estado: i.estado,
        verificar: r.verificar ?? null,
        documento: i.documento ? presentarDocumento(i.documento, hoy) : null,
      };
    }),
  };
}

/** Perfil del conductor autenticado: aprobación, vehículo y el estado de cada requisito. */
export class GetDriverProfileUseCase {
  constructor(
    private readonly drivers: DriverRepositoryPort,
    private readonly vehicles: VehicleRepositoryPort,
    private readonly documentos?: DocumentoConductorRepositoryPort,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async execute(actor: Actor) {
    const c = await conductorDelActor(this.drivers, actor);
    const [v] = await this.vehicles.findByDriverId(c.id_conductor);
    const docs = this.documentos ? await this.documentos.findByConductor(c.id_conductor) : [];
    const hoy = this.reloj();
    return {
      id_conductor: c.id_conductor,
      estado_aprobacion: c.estado_aprobacion,
      motivo_rechazo: c.motivo_rechazo ?? null,
      vehiculo: v ? { id: v.id as number, placa: v.placa, categoria: v.categoria } : null,
      requisitos: presentarRequisitos(evaluarRequisitos(docs, !!v, hoy), hoy),
    };
  }
}

/** CU-003: registro de vehículo del conductor autenticado. */
export class RegisterVehicleUseCase {
  constructor(
    private readonly vehicles: VehicleRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, input: { placa: unknown; categoria: unknown; id_conductor?: unknown }) {
    const c = await conductorDelActor(this.drivers, actor);
    exigirMismoId(input.id_conductor, c.id_conductor, 'id_conductor');
    const placa = normalizarPlaca(input.placa);
    if (!PLACA_RE.test(placa)) throw new ValidationError('La placa debe tener el formato ABC123 o ABC12D');
    if (!(CATEGORIAS_VEHICULO as readonly string[]).includes(String(input.categoria))) {
      throw new ValidationError(MENSAJE_CATEGORIA);
    }
    if (await this.vehicles.findByPlate(placa)) throw new ValidationError('La placa ya está registrada');

    const v = await this.vehicles.create({ placa, categoria: input.categoria as VehicleCategory, id_conductor: c.id_conductor });
    await this.audit.registrar(actor, { accion: 'Vehículo registrado', entidad: 'Vehículo', idEntidad: v.id, detalle: `${placa} (${v.categoria})` });
    return { id: v.id as number, placa: v.placa, categoria: v.categoria };
  }
}

/** CU-004: carga de documentos. Los que vencen exigen la fecha de vencimiento. */
export class UploadDriverDocumentUseCase {
  constructor(
    private readonly documentos: DocumentoConductorRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly storage: StoragePort,
    private readonly audit: AuditService,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async execute(actor: Actor, input: { tipo_documento: unknown; id_conductor?: unknown; fecha_vencimiento?: unknown }, archivo?: ArchivoSubido) {
    const c = await conductorDelActor(this.drivers, actor);
    exigirMismoId(input.id_conductor, c.id_conductor, 'id_conductor');
    const requisito = REQUISITOS.find((r) => r.tipo === input.tipo_documento);
    if (!requisito) throw new ValidationError(`Tipo de documento inválido. Debe ser: ${TIPOS_DOCUMENTO.join(', ')}`);
    if (!archivo) throw new ValidationError('No se proporcionó ningún archivo');
    if (!TIPOS_ARCHIVO_DOCUMENTO.includes(archivo.mimetype)) throw new ValidationError('Solo se permiten imágenes o PDF');
    let vencimiento: Date | null = null;
    if (requisito.vence) {
      vencimiento = fechaVencimientoValida(input.fecha_vencimiento, this.reloj());
      if (!vencimiento) throw new ValidationError(`Indica la fecha de vencimiento de: ${requisito.nombre} (debe estar vigente)`);
    }

    const url = await this.storage.upload(archivo, `trackit/documentos/${c.id_conductor}`);
    const doc = await this.documentos.create({ tipo_documento: requisito.tipo, url_archivo: url, id_conductor: c.id_conductor, fecha_vencimiento: vencimiento });
    // Rechazado o suspendido: al subir un documento vuelve a revisión
    if (c.estado_aprobacion === 'Rechazado' || c.estado_aprobacion === 'Suspendido') {
      await this.drivers.updateApprovalStatus(c.id_conductor, 'Pendiente', null);
    }
    await this.audit.registrar(actor, { accion: 'Documento cargado', entidad: 'Conductor', idEntidad: c.id_conductor, detalle: requisito.tipo });
    return { ...presentarDocumento({ ...doc, estado: doc.estado ?? 'Pendiente' }, this.reloj()), tipo_documento: doc.tipo_documento };
  }
}

/** CU-011: conductores por revisar, con su vehículo y el estado de cada requisito. */
export class ListDriverApplicantsUseCase {
  constructor(
    private readonly drivers: DriverRepositoryPort,
    private readonly documentos?: DocumentoConductorRepositoryPort,
    private readonly vehicles?: VehicleRepositoryPort,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async execute(actor: Actor) {
    exigirRol(actor, ROLES.ADMIN);
    const lista = await this.drivers.listApplicants();
    const hoy = this.reloj();
    return Promise.all(
      lista.map(async (c) => {
        const [docs, vehiculos] = await Promise.all([
          this.documentos ? this.documentos.findByConductor(c.id_conductor) : Promise.resolve([]),
          this.vehicles ? this.vehicles.findByDriverId(c.id_conductor) : Promise.resolve([]),
        ]);
        const evaluacion = evaluarRequisitos(docs, vehiculos.length > 0, hoy);
        const ultimos = [...ultimoPorTipo(docs).values()];
        return {
          id_conductor: c.id_conductor,
          nombre: c.nombre,
          correo: c.correo,
          estado_aprobacion: c.estado_aprobacion,
          motivo_rechazo: c.motivo_rechazo ?? null,
          vehiculo: vehiculos[0] ? { placa: vehiculos[0].placa, categoria: vehiculos[0].categoria } : null,
          documentos: ultimos.map((d) => presentarDocumento(d, hoy)),
          requisitos: presentarRequisitos(evaluacion, hoy),
          consultas: CONSULTAS_ADICIONALES,
        };
      }),
    );
  }
}

/** Motivo del rechazo (obligatorio al rechazar, entre 3 y 255 caracteres). */
function motivoRechazo(aprobado: boolean, crudo: unknown): string {
  const motivo = typeof crudo === 'string' ? crudo.trim() : '';
  if (!aprobado && (motivo.length < 3 || motivo.length > 255)) {
    throw new ValidationError('Escribe el motivo del rechazo para que el conductor sepa qué corregir');
  }
  return motivo;
}

function vencimientoOpcional(crudo: unknown, hoy: Date): Date | null {
  if (crudo === undefined || crudo === null || crudo === '') return null;
  const f = fechaVencimientoValida(crudo, hoy);
  if (!f) throw new ValidationError('La fecha de vencimiento no es válida o ya pasó');
  return f;
}

const nombreRequisito = (tipo: string) => REQUISITOS.find((r) => r.tipo === tipo)?.nombre ?? tipo;

/** "Vence hoy", "Vence en 1 día", "Vence en 9 días". */
export function textoVence(dias: number): string {
  if (dias <= 0) return 'Vence hoy';
  return dias === 1 ? 'Vence en 1 día' : `Vence en ${dias} días`;
}

/** El administrador aprueba o rechaza un documento (con motivo al rechazar). */
export class ReviewDriverDocumentUseCase {
  constructor(
    private readonly documentos: DocumentoConductorRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly audit: AuditService,
    private readonly notificaciones: NotificationService,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async execute(actor: Actor, idCrudo: unknown, input: { aprobado?: unknown; motivo?: unknown; fecha_vencimiento?: unknown }) {
    exigirRol(actor, ROLES.ADMIN);
    const id = idValido(idCrudo, 'id del documento');
    if (typeof input.aprobado !== 'boolean') throw new ValidationError('El campo "aprobado" debe ser true o false');
    const motivo = motivoRechazo(input.aprobado, input.motivo);
    const doc = await this.documentos.findById(id);
    if (!doc) throw new NotFoundError(`No existe el documento ${id}`);
    const conductor = await this.drivers.findById(doc.id_conductor);
    if (!conductor) throw new NotFoundError('El documento no pertenece a un conductor');
    const hoy = this.reloj();
    const vencimiento = vencimientoOpcional(input.fecha_vencimiento, hoy);
    const requisito = REQUISITOS.find((r) => r.tipo === doc.tipo_documento);
    if (input.aprobado && requisito?.vence && !vencimiento && !doc.fecha_vencimiento) {
      throw new ValidationError('Indica la fecha de vencimiento antes de aprobar este documento');
    }

    await this.documentos.review(id, {
      estado: input.aprobado ? 'Aprobado' : 'Rechazado',
      motivo_rechazo: input.aprobado ? null : motivo,
      fecha_vencimiento: vencimiento,
      revisado_en: hoy,
    });
    await this.audit.registrar(actor, {
      accion: input.aprobado ? 'Documento aprobado' : 'Documento rechazado',
      entidad: 'Conductor',
      idEntidad: conductor.id_conductor,
      detalle: input.aprobado ? doc.tipo_documento : `${doc.tipo_documento}: ${motivo}`,
    });
    if (!input.aprobado) {
      await this.notificaciones.notificar({
        id_usuario: conductor.id_usuario,
        tipo: 'documento_revisado',
        titulo: `Corrige tu ${nombreRequisito(doc.tipo_documento)}`,
        mensaje: `${motivo}. Sube el documento de nuevo desde tu perfil.`,
      });
    }
    return presentarDocumento((await this.documentos.findById(id)) as DocumentoConductor, hoy);
  }
}

/** CU-011: aprobar (solo con todos los requisitos completos) o rechazar con motivo. */
export class DecideDriverApprovalUseCase {
  constructor(
    private readonly drivers: DriverRepositoryPort,
    private readonly audit: AuditService,
    private readonly notificaciones: NotificationService,
    private readonly documentos?: DocumentoConductorRepositoryPort,
    private readonly vehicles?: VehicleRepositoryPort,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async execute(actor: Actor, input: { driverId: unknown; approved: unknown; observation?: unknown }) {
    exigirRol(actor, ROLES.ADMIN);
    const id = idValido(input.driverId, 'driverId');
    if (typeof input.approved !== 'boolean') throw new ValidationError('El campo "approved" debe ser true o false');
    const motivo = typeof input.observation === 'string' ? input.observation.trim() : '';
    if (!input.approved && (motivo.length < 1 || motivo.length > 255)) {
      throw new ValidationError('El motivo del rechazo es obligatorio (máximo 255 caracteres)');
    }

    const c = await this.drivers.findById(id);
    if (!c) throw new NotFoundError(`No existe el conductor con id ${id}`);
    if (c.estado_aprobacion === 'Aprobado') throw new ValidationError('Este conductor ya ha sido aprobado previamente');
    if (input.approved) await this.exigirRequisitos(id);

    const estado = input.approved ? 'Aprobado' : 'Rechazado';
    await this.drivers.updateApprovalStatus(id, estado, input.approved ? null : motivo);
    await this.audit.registrar(actor, {
      accion: input.approved ? 'Conductor aprobado' : 'Conductor rechazado',
      entidad: 'Conductor',
      idEntidad: id,
      detalle: input.approved ? c.correo : `${c.correo}: ${motivo}`,
    });
    await this.notificaciones.notificar(
      input.approved
        ? {
            id_usuario: c.id_usuario,
            tipo: 'conductor_aprobado',
            titulo: '¡Tu cuenta fue aprobada!',
            mensaje: 'Ya puedes tomar servicios desde el tablero. Bienvenido al equipo TrackIt Express.',
          }
        : {
            id_usuario: c.id_usuario,
            tipo: 'conductor_rechazado',
            titulo: 'Revisa tus documentos',
            mensaje: `Tu solicitud no fue aprobada: ${motivo}. Sube los documentos corregidos para volver a revisión.`,
          },
    );
    return { id_conductor: c.id_conductor, nombre: c.nombre, correo: c.correo, estado_aprobacion: estado, motivo_rechazo: input.approved ? null : motivo };
  }

  private async exigirRequisitos(id: number): Promise<void> {
    if (!this.documentos || !this.vehicles) return;
    const [docs, vehiculos] = await Promise.all([this.documentos.findByConductor(id), this.vehicles.findByDriverId(id)]);
    const ev = evaluarRequisitos(docs, vehiculos.length > 0, this.reloj());
    if (!ev.completo) throw new ValidationError(`Aún no se puede aprobar: ${ev.pendientes.join('; ')}`);
  }
}

/**
 * Control diario de vencimientos: suspende a los conductores aprobados con un documento vencido
 * y avisa una vez a quienes tienen uno a punto de vencer.
 */
export class CheckDocumentExpiryUseCase {
  constructor(
    private readonly documentos: DocumentoConductorRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly audit: AuditService,
    private readonly notificaciones: NotificationService,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<{ suspendidos: number; avisados: number }> {
    const hoy = this.reloj();
    const porConductor = new Map<number, DocumentoConductor[]>();
    for (const d of await this.documentos.findVigilados()) {
      porConductor.set(d.id_conductor, [...(porConductor.get(d.id_conductor) ?? []), d]);
    }
    let suspendidos = 0;
    let avisados = 0;
    for (const [idConductor, docs] of porConductor) {
      const c = await this.drivers.findById(idConductor);
      if (c?.estado_aprobacion !== 'Aprobado') continue;
      const ultimos = [...ultimoPorTipo(docs).values()];
      if (await this.suspenderSiVencio(c, ultimos, hoy)) suspendidos++;
      else avisados += await this.avisarPorVencer(c, ultimos, hoy);
    }
    return { suspendidos, avisados };
  }

  private async suspenderSiVencio(c: Conductor, docs: DocumentoConductor[], hoy: Date): Promise<boolean> {
    const vencidos = docs.filter((d) => (diasParaVencer(d, hoy) ?? 0) < 0);
    if (vencidos.length === 0) return false;
    const nombres = vencidos.map((d) => nombreRequisito(d.tipo_documento)).join(', ');
    await this.drivers.updateApprovalStatus(c.id_conductor, 'Suspendido', `Documento vencido: ${nombres}`);
    await this.audit.registrar(null, { accion: 'Conductor suspendido', entidad: 'Conductor', idEntidad: c.id_conductor, detalle: `Vencido: ${nombres}` });
    await this.notificaciones.notificar({
      id_usuario: c.id_usuario,
      tipo: 'conductor_suspendido',
      titulo: 'Tu cuenta quedó en pausa',
      mensaje: `Venció: ${nombres}. Sube el documento renovado desde tu perfil para volver a tomar servicios.`,
    });
    return true;
  }

  /** Avisa una sola vez por documento cuando faltan 15 días o menos. Devuelve cuántos avisos envió. */
  private async avisarPorVencer(c: Conductor, docs: DocumentoConductor[], hoy: Date): Promise<number> {
    let avisos = 0;
    for (const d of docs) {
      const dias = diasParaVencer(d, hoy);
      if (dias === null || dias > DIAS_AVISO_VENCIMIENTO || d.aviso_vencimiento_en) continue;
      await this.notificaciones.notificar({
        id_usuario: c.id_usuario,
        tipo: 'documento_por_vencer',
        titulo: `Tu ${nombreRequisito(d.tipo_documento)} vence pronto`,
        mensaje: `${textoVence(dias)}. Súbelo renovado para no quedar en pausa.`,
      });
      await this.documentos.markWarned(d.id as number, hoy);
      avisos++;
    }
    return avisos;
  }
}

/** Resumen del conductor: servicios completados, ganancias y reputación. */
export class GetDriverSummaryUseCase {
  constructor(
    private readonly drivers: DriverRepositoryPort,
    private readonly envios: ShipmentRepositoryPort,
  ) {}

  async execute(actor: Actor) {
    const c = await conductorDelActor(this.drivers, actor);
    const [resumen, activos] = await Promise.all([
      this.envios.driverSummary(c.id_conductor),
      this.envios.findByDriver(c.id_conductor, ESTADOS_ACTIVOS_CONDUCTOR),
    ]);
    return { ...resumen, servicio_activo: activos[0]?.id_envio ?? null };
  }
}

/** Servicios terminados del conductor (entregados o cancelados), del más reciente al más antiguo. */
export class ListDriverHistoryUseCase {
  constructor(
    private readonly drivers: DriverRepositoryPort,
    private readonly envios: ShipmentRepositoryPort,
  ) {}

  async execute(actor: Actor, limiteCrudo?: unknown): Promise<EnvioApi[]> {
    const c = await conductorDelActor(this.drivers, actor);
    const limite = Math.min(200, Math.max(1, Number.parseInt(String(limiteCrudo ?? '50'), 10) || 50));
    const lista = await this.envios.findDriverHistory(c.id_conductor, limite);
    return lista.map((e) => presentarEnvio(e, { incluirPin: false, vistaConductor: true }));
  }
}
