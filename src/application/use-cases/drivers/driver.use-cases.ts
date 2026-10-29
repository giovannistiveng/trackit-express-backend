import { Actor, ROLES } from '../../../domain/entities/actor.entity';
import { TipoDocumento } from '../../../domain/entities/documento-conductor.entity';
import { CATEGORIAS_VEHICULO, VehicleCategory } from '../../../domain/entities/vehicle.entity';
import { DocumentoConductorRepositoryPort } from '../../../domain/repositories/documento-conductor.repository.port';
import { DriverRepositoryPort } from '../../../domain/repositories/driver.repository.port';
import { ArchivoSubido, StoragePort } from '../../../domain/repositories/storage.port';
import { VehicleRepositoryPort } from '../../../domain/repositories/vehicle.repository.port';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import { AuditService } from '../../services/audit.service';
import { conductorDelActor, exigirMismoId, exigirRol } from '../../services/access';
import { idValido } from '../../validation';

export const TIPOS_DOCUMENTO: TipoDocumento[] = ['Cédula', 'SOAT', 'Licencia'];
export const TIPOS_ARCHIVO_DOCUMENTO = ['image/jpeg', 'image/png', 'application/pdf'];
const PLACA_RE = /^[A-Z]{3}\d{2}[A-Z0-9]$/;

export function normalizarPlaca(valor: unknown): string {
  return String(valor ?? '').toUpperCase().replace(/[\s-]+/g, '');
}

/** Perfil del conductor autenticado: id, aprobación, motivo de rechazo y vehículo. */
export class GetDriverProfileUseCase {
  constructor(
    private readonly drivers: DriverRepositoryPort,
    private readonly vehicles: VehicleRepositoryPort,
  ) {}

  async execute(actor: Actor) {
    const c = await conductorDelActor(this.drivers, actor);
    const [v] = await this.vehicles.findByDriverId(c.id_conductor);
    return {
      id_conductor: c.id_conductor,
      estado_aprobacion: c.estado_aprobacion,
      motivo_rechazo: c.motivo_rechazo ?? null,
      vehiculo: v ? { id: v.id as number, placa: v.placa, categoria: v.categoria } : null,
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
      throw new ValidationError('Categoría inválida. Debe ser: Moto Express, Motocarro o Camioneta');
    }
    if (await this.vehicles.findByPlate(placa)) throw new ValidationError('La placa ya está registrada');

    const v = await this.vehicles.create({ placa, categoria: input.categoria as VehicleCategory, id_conductor: c.id_conductor });
    await this.audit.registrar(actor, { accion: 'Vehículo registrado', entidad: 'Vehículo', idEntidad: v.id, detalle: `${placa} (${v.categoria})` });
    return { id: v.id as number, placa: v.placa, categoria: v.categoria };
  }
}

/** CU-004: carga de documentos del conductor autenticado. */
export class UploadDriverDocumentUseCase {
  constructor(
    private readonly documentos: DocumentoConductorRepositoryPort,
    private readonly drivers: DriverRepositoryPort,
    private readonly storage: StoragePort,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: Actor, input: { tipo_documento: unknown; id_conductor?: unknown }, archivo?: ArchivoSubido) {
    const c = await conductorDelActor(this.drivers, actor);
    exigirMismoId(input.id_conductor, c.id_conductor, 'id_conductor');
    if (!TIPOS_DOCUMENTO.includes(input.tipo_documento as TipoDocumento)) {
      throw new ValidationError('Tipo de documento inválido. Debe ser: Cédula, SOAT o Licencia');
    }
    if (!archivo) throw new ValidationError('No se proporcionó ningún archivo');
    if (!TIPOS_ARCHIVO_DOCUMENTO.includes(archivo.mimetype)) throw new ValidationError('Solo se permiten imágenes o PDF');

    const url = await this.storage.upload(archivo, `trackit/documentos/${c.id_conductor}`);
    const doc = await this.documentos.create({ tipo_documento: input.tipo_documento as TipoDocumento, url_archivo: url, id_conductor: c.id_conductor });
    // Si estaba rechazado, al subir un documento nuevo vuelve a revisión
    if (c.estado_aprobacion === 'Rechazado') await this.drivers.updateApprovalStatus(c.id_conductor, 'Pendiente', null);
    await this.audit.registrar(actor, { accion: 'Documento cargado', entidad: 'Conductor', idEntidad: c.id_conductor, detalle: String(input.tipo_documento) });
    return { id: doc.id as number, url_archivo: doc.url_archivo, tipo_documento: doc.tipo_documento };
  }
}

/** CU-011: conductores pendientes o rechazados, con sus documentos. */
export class ListDriverApplicantsUseCase {
  constructor(private readonly drivers: DriverRepositoryPort) {}

  async execute(actor: Actor) {
    exigirRol(actor, ROLES.ADMIN);
    const lista = await this.drivers.listApplicants();
    return lista.map((c) => ({
      id_conductor: c.id_conductor,
      nombre: c.nombre,
      correo: c.correo,
      estado_aprobacion: c.estado_aprobacion,
      motivo_rechazo: c.motivo_rechazo ?? null,
      documentos: c.documentos,
    }));
  }
}

/** CU-011: aprobar o rechazar (con motivo obligatorio al rechazar). */
export class DecideDriverApprovalUseCase {
  constructor(
    private readonly drivers: DriverRepositoryPort,
    private readonly audit: AuditService,
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

    const estado = input.approved ? 'Aprobado' : 'Rechazado';
    await this.drivers.updateApprovalStatus(id, estado, input.approved ? null : motivo);
    await this.audit.registrar(actor, {
      accion: input.approved ? 'Conductor aprobado' : 'Conductor rechazado',
      entidad: 'Conductor',
      idEntidad: id,
      detalle: input.approved ? c.correo : `${c.correo}: ${motivo}`,
    });
    return { id_conductor: c.id_conductor, nombre: c.nombre, correo: c.correo, estado_aprobacion: estado, motivo_rechazo: input.approved ? null : motivo };
  }
}
