import { Actor, ROLES } from '../../domain/entities/actor.entity';
import { Conductor } from '../../domain/entities/driver.entity';
import { Envio } from '../../domain/entities/shipment.entity';
import { DriverRepositoryPort } from '../../domain/repositories/driver.repository.port';
import { ShipmentRepositoryPort } from '../../domain/repositories/shipment.repository.port';
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors';
import { idValido } from '../validation';

export function exigirRol(actor: Actor, ...roles: number[]): void {
  if (!roles.includes(actor.role)) throw new ForbiddenError();
}

/** Si el cuerpo trae un id explícito, debe coincidir con el del usuario autenticado. */
export function exigirMismoId(valorCuerpo: unknown, idReal: number, campo: string): void {
  if (valorCuerpo === undefined || valorCuerpo === null || valorCuerpo === '') return;
  if (Number(valorCuerpo) !== idReal) throw new ForbiddenError(`El ${campo} no corresponde al usuario autenticado`);
}

/** Perfil del conductor autenticado (se crea si un conductor antiguo no lo tenía). */
export async function conductorDelActor(drivers: DriverRepositoryPort, actor: Actor): Promise<Conductor> {
  exigirRol(actor, ROLES.CONDUCTOR);
  return (await drivers.findByUserId(actor.userId)) ?? drivers.ensureForUser(actor.userId);
}

export async function conductorAprobado(drivers: DriverRepositoryPort, actor: Actor): Promise<Conductor> {
  const c = await conductorDelActor(drivers, actor);
  if (c.estado_aprobacion !== 'Aprobado') {
    throw new ForbiddenError('Tu cuenta de conductor aún no está aprobada');
  }
  return c;
}

export async function envioExistente(envios: ShipmentRepositoryPort, idCrudo: unknown): Promise<Envio> {
  const id = idValido(idCrudo, 'id del envío');
  const envio = await envios.findById(id);
  if (!envio) throw new NotFoundError(`No existe el envío con id ${id}`);
  return envio;
}

/** Envío asignado al conductor autenticado. */
export async function envioDelConductor(envios: ShipmentRepositoryPort, drivers: DriverRepositoryPort, actor: Actor, idCrudo: unknown) {
  const conductor = await conductorDelActor(drivers, actor);
  const envio = await envioExistente(envios, idCrudo);
  if (envio.id_conductor !== conductor.id_conductor) {
    throw new ForbiddenError('Este servicio no está asignado a ti');
  }
  return { envio, conductor };
}

export function exigirEstado(envio: Envio, permitidos: string[], mensaje: string): void {
  if (!permitidos.includes(envio.estado ?? 'Pendiente')) throw new ValidationError(mensaje);
}
