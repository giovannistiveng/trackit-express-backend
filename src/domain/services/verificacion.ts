import { DocumentoConductor, TipoDocumento } from '../entities/documento-conductor.entity';

/**
 * Verificación de conductores: qué documentos se exigen, cuáles vencen y dónde los comprueba
 * el administrador en las fuentes oficiales de Colombia.
 */
export interface Requisito {
  tipo: TipoDocumento;
  nombre: string;
  /** Qué debe subir el conductor. */
  ayuda: string;
  obligatorio: boolean;
  /** El conductor debe indicar la fecha de vencimiento al subirlo. */
  vence: boolean;
  /** Dónde lo comprueba el administrador. */
  verificar?: { fuente: string; url: string };
}

export const RUNT_PERSONA = 'https://www.runt.gov.co/actores/ciudadano/consulta-de-ciudadanos-por-documento';
export const RUNT_PLACA = 'https://www.runt.gov.co/actores/ciudadano/consulta-de-vehiculos-por-placa';

export const REQUISITOS: Requisito[] = [
  {
    tipo: 'Cédula',
    nombre: 'Cédula de ciudadanía',
    ayuda: 'Foto de la cédula por ambos lados (puede ser la digital).',
    obligatorio: true,
    vence: false,
    verificar: { fuente: 'Registraduría', url: 'https://www.registraduria.gov.co' },
  },
  {
    tipo: 'Selfie',
    nombre: 'Selfie con la cédula',
    ayuda: 'Una foto de tu cara sosteniendo la cédula junto a ella, con buena luz.',
    obligatorio: true,
    vence: false,
  },
  {
    tipo: 'Licencia',
    nombre: 'Licencia de conducción',
    ayuda: 'Foto de la licencia por ambos lados. Debe tener la categoría de tu vehículo.',
    obligatorio: true,
    vence: true,
    verificar: { fuente: 'RUNT (consulta por documento)', url: RUNT_PERSONA },
  },
  {
    tipo: 'SOAT',
    nombre: 'SOAT',
    ayuda: 'Póliza vigente del vehículo que vas a usar.',
    obligatorio: true,
    vence: true,
    verificar: { fuente: 'RUNT (consulta por placa)', url: RUNT_PLACA },
  },
  {
    tipo: 'Tarjeta de propiedad',
    nombre: 'Tarjeta de propiedad (licencia de tránsito)',
    ayuda: 'Debe coincidir con la placa que registraste.',
    obligatorio: true,
    vence: false,
    verificar: { fuente: 'RUNT (consulta por placa)', url: RUNT_PLACA },
  },
  {
    tipo: 'Tecnomecánica',
    nombre: 'Revisión técnico-mecánica',
    ayuda: 'Solo si tu vehículo ya debe tenerla (motos desde los 2 años, carros desde los 5).',
    obligatorio: false,
    vence: true,
    verificar: { fuente: 'RUNT (consulta por placa)', url: RUNT_PLACA },
  },
  {
    tipo: 'Antecedentes',
    nombre: 'Antecedentes judiciales',
    ayuda: 'Certificado de la Policía Nacional descargado este mes. Se renueva cada año.',
    obligatorio: true,
    vence: false,
    verificar: { fuente: 'Policía Nacional', url: 'https://antecedentes.policia.gov.co:7005/WebJudicial/index.xhtml' },
  },
];

/** Consultas extra que el administrador hace con la cédula del conductor. */
export const CONSULTAS_ADICIONALES = [
  { fuente: 'Procuraduría (antecedentes disciplinarios)', url: 'https://apps.procuraduria.gov.co/webcert/inicio.aspx' },
  { fuente: 'SIMIT (multas de tránsito)', url: 'https://www.fcm.org.co/simit/#/home-public' },
];

/** Se avisa al conductor esta cantidad de días antes de que venza un documento. */
export const DIAS_AVISO_VENCIMIENTO = 15;
/** Los antecedentes se piden de nuevo cada año. */
export const DIAS_VIGENCIA_ANTECEDENTES = 365;

export type EstadoRequisito = 'falta' | 'pendiente' | 'aprobado' | 'rechazado' | 'vencido';

export interface RequisitoEvaluado {
  tipo: TipoDocumento;
  nombre: string;
  obligatorio: boolean;
  estado: EstadoRequisito;
  documento: DocumentoConductor | null;
  /** Días que faltan para el vencimiento (negativo si ya venció); null si no vence. */
  dias_para_vencer: number | null;
}

export interface EvaluacionRequisitos {
  /** Todos los obligatorios aprobados y vigentes, y un vehículo registrado. */
  completo: boolean;
  items: RequisitoEvaluado[];
  /** Explicación corta de lo que falta, para mostrar al conductor o al administrador. */
  pendientes: string[];
}

const DIA_MS = 86_400_000;

/** Último documento de cada tipo (el más reciente reemplaza a los anteriores). */
export function ultimoPorTipo(docs: DocumentoConductor[]): Map<TipoDocumento, DocumentoConductor> {
  const ordenados = [...docs].sort((a, b) => (b.fecha_subida?.getTime() ?? 0) - (a.fecha_subida?.getTime() ?? 0) || (b.id ?? 0) - (a.id ?? 0));
  const mapa = new Map<TipoDocumento, DocumentoConductor>();
  for (const d of ordenados) if (!mapa.has(d.tipo_documento)) mapa.set(d.tipo_documento, d);
  return mapa;
}

/** Fecha en la que deja de valer un documento (null si no vence). */
export function venceEl(doc: DocumentoConductor): Date | null {
  if (doc.fecha_vencimiento) return doc.fecha_vencimiento;
  if (doc.tipo_documento === 'Antecedentes' && doc.fecha_subida) {
    return new Date(doc.fecha_subida.getTime() + DIAS_VIGENCIA_ANTECEDENTES * DIA_MS);
  }
  return null;
}

export function diasParaVencer(doc: DocumentoConductor, hoy: Date): number | null {
  const fecha = venceEl(doc);
  if (!fecha) return null;
  // Vence al terminar ese día
  const fin = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()) + DIA_MS;
  return Math.ceil((fin - hoy.getTime()) / DIA_MS) - 1;
}

const ESTADO_REVISION = { Pendiente: 'pendiente', Aprobado: 'aprobado', Rechazado: 'rechazado' } as const;

function estadoDe(doc: DocumentoConductor | null, dias: number | null): EstadoRequisito {
  if (!doc) return 'falta';
  if (dias !== null && dias < 0) return 'vencido';
  return ESTADO_REVISION[doc.estado ?? 'Pendiente'];
}

/** Qué le falta a un requisito, en una frase (null si está bien o es opcional y no se subió). */
function textoPendiente(i: RequisitoEvaluado): string | null {
  // Un documento opcional que se subió también debe estar vigente y aprobado
  if (!i.obligatorio && i.estado === 'falta') return null;
  const motivo = i.documento?.motivo_rechazo ? ` (${i.documento.motivo_rechazo})` : '';
  const textos: Record<EstadoRequisito, string | null> = {
    falta: `Sube: ${i.nombre}`,
    pendiente: `En revisión: ${i.nombre}`,
    rechazado: `Corrige: ${i.nombre}${motivo}`,
    vencido: `Renueva: ${i.nombre}`,
    aprobado: null,
  };
  return textos[i.estado];
}

export function evaluarRequisitos(docs: DocumentoConductor[], tieneVehiculo: boolean, hoy: Date): EvaluacionRequisitos {
  const ultimos = ultimoPorTipo(docs);
  const items = REQUISITOS.map((r): RequisitoEvaluado => {
    const doc = ultimos.get(r.tipo) ?? null;
    const dias = doc ? diasParaVencer(doc, hoy) : null;
    return { tipo: r.tipo, nombre: r.nombre, obligatorio: r.obligatorio, estado: estadoDe(doc, dias), documento: doc, dias_para_vencer: dias };
  });
  const pendientes = [
    ...(tieneVehiculo ? [] : ['Registra tu vehículo']),
    ...items.map(textoPendiente).filter((t): t is string => t !== null),
  ];
  return { completo: pendientes.length === 0, items, pendientes };
}

/** Fecha de vencimiento válida (formato AAAA-MM-DD, futura y a menos de 15 años). */
export function fechaVencimientoValida(valor: unknown, hoy: Date): Date | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const texto = String(valor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  const f = new Date(`${texto}T00:00:00Z`);
  if (Number.isNaN(f.getTime())) return null;
  const hoyUtc = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  if (f.getTime() < hoyUtc || f.getTime() > hoyUtc + 15 * 365 * DIA_MS) return null;
  return f;
}
