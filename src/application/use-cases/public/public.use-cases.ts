import { ASUNTOS_CONTACTO, AsuntoContacto } from '../../../domain/entities/contacto.entity';
import { EstadisticasPublicas } from '../../../domain/entities/metricas.entity';
import { ContactRepositoryPort } from '../../../domain/repositories/contact.repository.port';
import { MetricsRepositoryPort } from '../../../domain/repositories/metrics.repository.port';
import { ZonaTarifaRepositoryPort } from '../../../domain/repositories/zona-tarifa.repository.port';
import { ValidationError } from '../../../shared/errors';
import { AuditService } from '../../services/audit.service';
import { esCorreo, telefonoOpcional, textoValido } from '../../validation';

/** Cifras del sitio público. Se guardan en memoria un minuto para no consultar la base en cada visita. */
export class GetPublicStatsUseCase {
  private cache: { valor: EstadisticasPublicas; vence: number } | null = null;

  constructor(
    private readonly metricas: MetricsRepositoryPort,
    private readonly ahora: () => number = Date.now,
    private readonly vigenciaMs = 60_000,
  ) {}

  async execute(): Promise<EstadisticasPublicas> {
    if (this.cache && this.cache.vence > this.ahora()) return this.cache.valor;
    const valor = await this.metricas.publicas();
    this.cache = { valor, vence: this.ahora() + this.vigenciaMs };
    return valor;
  }
}

/** Zonas de cobertura con su tarifa base, para la sección de tarifas del sitio. */
export class ListPublicZonesUseCase {
  constructor(private readonly zonas: ZonaTarifaRepositoryPort) {}

  async execute() {
    return (await this.zonas.findAll()).map((z) => ({ id_zona: z.id_zona as number, nombre_zona: z.nombre_zona, tarifa_base: z.tarifa_base }));
  }
}

/** Formulario de contacto del sitio público. */
export class SubmitContactUseCase {
  constructor(
    private readonly repo: ContactRepositoryPort,
    private readonly audit: AuditService,
  ) {}

  async execute(input: { nombre?: unknown; correo?: unknown; telefono?: unknown; asunto?: unknown; mensaje?: unknown }) {
    const nombre = textoValido(input.nombre, 'nombre', 3, 120);
    const correo = typeof input.correo === 'string' ? input.correo.trim().toLowerCase() : '';
    if (!esCorreo(correo)) throw new ValidationError('El correo no es válido');
    const telefono = telefonoOpcional(input.telefono);
    const asunto = (input.asunto ?? 'General') as AsuntoContacto;
    if (!ASUNTOS_CONTACTO.includes(asunto)) throw new ValidationError(`El asunto debe ser: ${ASUNTOS_CONTACTO.join(', ')}`);
    const mensaje = textoValido(input.mensaje, 'mensaje', 10, 1000);
    const m = await this.repo.save({ nombre, correo, telefono, asunto, mensaje });
    await this.audit.registrar(null, { accion: 'Mensaje de contacto', entidad: 'Contacto', idEntidad: m.id, detalle: `${correo} (${asunto})` });
    return { id: m.id as number };
  }
}
