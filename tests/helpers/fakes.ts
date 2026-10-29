import { Actor } from '../../src/domain/entities/actor.entity';
import { Conductor } from '../../src/domain/entities/driver.entity';
import { Envio, EnvioDetallado, EstadoEnvio } from '../../src/domain/entities/shipment.entity';
import { Vehicle } from '../../src/domain/entities/vehicle.entity';
import { DriverRepositoryPort, ConductorPostulante } from '../../src/domain/repositories/driver.repository.port';
import { ShipmentRepositoryPort, HistorialEstadoRow, EnvioAdmin } from '../../src/domain/repositories/shipment.repository.port';
import { NotificationRepositoryPort } from '../../src/domain/repositories/notification.repository.port';
import { Notificacion } from '../../src/domain/entities/notificacion.entity';
import { NotificationService } from '../../src/application/services/notification.service';
import { VehicleRepositoryPort } from '../../src/domain/repositories/vehicle.repository.port';
import { AuditRepositoryPort } from '../../src/domain/repositories/audit.repository.port';
import { AuditService } from '../../src/application/services/audit.service';

export const CLIENTE: Actor = { userId: 10, role: 2, email: 'cli@t.co' };
export const CONDUCTOR: Actor = { userId: 20, role: 3, email: 'con@t.co' };
export const ADMIN: Actor = { userId: 1, role: 1, email: 'adm@t.co' };

export function envio(p: Partial<Envio> = {}): Envio {
  return { id_envio: 1, origen: 'A', destino: 'B', tipo_carga: 'Documentos', tarifa: 1000, pin_seguridad: '1234', id_cliente: 10, id_zona: 1, estado: 'Pendiente', ...p };
}

export class FakeShipments implements ShipmentRepositoryPort {
  envios = new Map<number, Envio>();
  calificaciones = new Map<number, number>();
  historial: HistorialEstadoRow[] = [];
  async create(e: Omit<Envio, 'id_envio'>) {
    const n = { ...e, id_envio: this.envios.size + 1, estado: 'Pendiente' as EstadoEnvio };
    this.envios.set(n.id_envio, n);
    return n;
  }
  async findById(id: number) {
    return this.envios.get(id) ?? null;
  }
  async findByClient(id: number, estados?: EstadoEnvio[]): Promise<EnvioDetallado[]> {
    return [...this.envios.values()].filter((e) => e.id_cliente === id && (!estados || estados.includes(e.estado as EstadoEnvio)));
  }
  async findByDriver(id: number, estados?: EstadoEnvio[]) {
    return [...this.envios.values()].filter((e) => e.id_conductor === id && (!estados || estados.includes(e.estado as EstadoEnvio)));
  }
  async findAvailable() {
    return [...this.envios.values()].filter((e) => e.estado === 'Pendiente' && !e.id_conductor);
  }
  async updateStatus(id: number, estado: EstadoEnvio, idConductor?: number) {
    const e = this.envios.get(id) as Envio;
    this.envios.set(id, { ...e, estado, id_conductor: idConductor ?? e.id_conductor });
  }
  async getStatusHistory() {
    return this.historial;
  }
  async registerDelivery(id: number) {
    await this.updateStatus(id, 'Entregado');
  }
  async findCalification(id: number) {
    return this.calificaciones.get(id) ?? null;
  }
  async saveCalification(id: number, p: number) {
    this.calificaciones.set(id, p);
  }
  async cancel(id: number, motivo: string | null) {
    const e = this.envios.get(id) as Envio;
    if (e.estado === 'Entregado' || e.estado === 'Cancelado') throw new Error('estado final');
    this.envios.set(id, { ...e, estado: 'Cancelado', motivo_cancelacion: motivo });
  }
  async findDriverHistory(id: number) {
    return [...this.envios.values()].filter((e) => e.id_conductor === id && (e.estado === 'Entregado' || e.estado === 'Cancelado'));
  }
  async driverSummary() {
    return { completados: 0, ingresos_total: 0, ingresos_mes: 0, calificacion_promedio: null, total_calificaciones: 0 };
  }
  async searchAdmin(): Promise<{ items: EnvioAdmin[]; total: number }> {
    return { items: [], total: 0 };
  }
}

export class FakeNotifications implements NotificationRepositoryPort {
  avisos: Notificacion[] = [];
  async save(n: Notificacion) {
    this.avisos.push({ ...n, id: this.avisos.length + 1, leida: false, fecha: new Date() });
  }
  async findByUser(id: number, o: { soloNoLeidas: boolean; limite: number }) {
    return this.avisos.filter((a) => a.id_usuario === id && (!o.soloNoLeidas || !a.leida)).slice(0, o.limite);
  }
  async countUnread(id: number) {
    return this.avisos.filter((a) => a.id_usuario === id && !a.leida).length;
  }
  async markRead(idN: number, idU: number) {
    const a = this.avisos.find((x) => x.id === idN && x.id_usuario === idU);
    if (a) a.leida = true;
    return !!a;
  }
  async markAllRead(idU: number) {
    const pendientes = this.avisos.filter((x) => x.id_usuario === idU && !x.leida);
    pendientes.forEach((a) => (a.leida = true));
    return pendientes.length;
  }
}

export function notificacionesFalsas() {
  const repo = new FakeNotifications();
  return { repo, servicio: new NotificationService(repo) };
}

export class FakeDrivers implements DriverRepositoryPort {
  conductores: Conductor[] = [];
  async findById(id: number) {
    return this.conductores.find((c) => c.id_conductor === id) ?? null;
  }
  async findByUserId(id: number) {
    return this.conductores.find((c) => c.id_usuario === id) ?? null;
  }
  async ensureForUser(id: number) {
    const c: Conductor = { id_conductor: this.conductores.length + 1, id_usuario: id, nombre: 'Con', correo: 'con@t.co', estado_aprobacion: 'Pendiente' };
    this.conductores.push(c);
    return c;
  }
  async updateApprovalStatus(id: number, estado: Conductor['estado_aprobacion'], motivo: string | null = null) {
    const c = await this.findById(id);
    if (c) Object.assign(c, { estado_aprobacion: estado, motivo_rechazo: motivo });
  }
  async listApplicants(): Promise<ConductorPostulante[]> {
    return this.conductores.filter((c) => c.estado_aprobacion !== 'Aprobado').map((c) => ({ ...c, documentos: [] }));
  }
  async averageRating() {
    return null;
  }
}

export class FakeVehicles implements VehicleRepositoryPort {
  vehiculos: Vehicle[] = [];
  async create(v: Omit<Vehicle, 'id'>) {
    const n = { ...v, id: this.vehiculos.length + 1 };
    this.vehiculos.push(n);
    return n;
  }
  async findByPlate(p: string) {
    return this.vehiculos.find((v) => v.placa === p) ?? null;
  }
  async findByDriverId(id: number) {
    return this.vehiculos.filter((v) => v.id_conductor === id);
  }
}

export class FakeAuditRepo implements AuditRepositoryPort {
  registros: Parameters<AuditRepositoryPort['save']>[0][] = [];
  async save(r: Parameters<AuditRepositoryPort['save']>[0]) {
    this.registros.push(r);
  }
  async search() {
    return { items: this.registros, total: this.registros.length };
  }
}

export function auditFalso() {
  const repo = new FakeAuditRepo();
  return { repo, audit: new AuditService(repo) };
}

/** Conductor aprobado ligado al actor CONDUCTOR. */
export function conductorAprobado(drivers: FakeDrivers, id = 5): Conductor {
  const c: Conductor = { id_conductor: id, id_usuario: CONDUCTOR.userId, nombre: 'Con', correo: 'con@t.co', estado_aprobacion: 'Aprobado' };
  drivers.conductores.push(c);
  return c;
}
