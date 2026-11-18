import { CATEGORIAS_VEHICULO, VehicleCategory } from '../entities/vehicle.entity';

/**
 * Tipos de servicio de TrackIt. Cada uno pide datos distintos al crear el pedido y puede sumar
 * recargos propios (ayudantes, pisos sin ascensor, vía destapada).
 */
export const TIPOS_SERVICIO = ['mandado', 'mercado', 'paquete', 'trasteo', 'insumos'] as const;
export type TipoServicio = (typeof TIPOS_SERVICIO)[number];

export interface InfoServicio {
  nombre: string;
  /** Texto que se guarda en tipo_carga (compatibilidad con reportes anteriores). */
  tipoCarga: string;
  /** Vehículo más pequeño que puede hacer el servicio sin conocer el peso. */
  vehiculoMinimo: VehicleCategory;
  /** true si alguien entrega la carga en el origen y debe dar el código de recogida. */
  pideCodigoRecogida: boolean;
  /** true si el conductor compra algo y lo cobra contra la factura. */
  conCompra: boolean;
}

export const SERVICIOS: Record<TipoServicio, InfoServicio> = {
  mandado: { nombre: 'Mandado', tipoCarga: 'Mandado', vehiculoMinimo: 'Moto Express', pideCodigoRecogida: false, conCompra: true },
  mercado: { nombre: 'Mercado', tipoCarga: 'Mercado', vehiculoMinimo: 'Moto Express', pideCodigoRecogida: false, conCompra: true },
  paquete: { nombre: 'Paquete', tipoCarga: 'Mercancía General', vehiculoMinimo: 'Moto Express', pideCodigoRecogida: true, conCompra: false },
  trasteo: { nombre: 'Trasteo', tipoCarga: 'Acarreo', vehiculoMinimo: 'Furgoneta', pideCodigoRecogida: true, conCompra: false },
  insumos: { nombre: 'Insumos del campo', tipoCarga: 'Carga Pesada', vehiculoMinimo: 'Moto Express', pideCodigoRecogida: true, conCompra: false },
};

/**
 * Peso máximo que lleva cada vehículo (kg). La moto hace mandados, mercados y paquetes livianos;
 * la furgoneta, los trasteos y la carga pesada.
 */
export const CAPACIDAD_KG: Record<VehicleCategory, number> = {
  'Moto Express': 20,
  Furgoneta: 1500,
};
export const PESO_MAXIMO_KG = CAPACIDAD_KG['Furgoneta'];

/** Valor de cada ayudante en un trasteo (carga y descarga). */
export const VALOR_AYUDANTE = 25000;
export const MAX_AYUDANTES = 3;
/** Por cada piso sin ascensor por encima del primero, en el origen o el destino. */
export const VALOR_PISO = 4000;
export const MAX_PISOS = 30;
/** Vía destapada o finca: recargo sobre el valor del viaje. */
export const RECARGO_DESTAPADO = 0.15;
export const MAX_BULTOS = 200;

/** Datos propios de cada tipo de servicio. Todos opcionales salvo los que exige cada tipo. */
export interface DetalleServicio {
  /** Cantidad de bultos, cajas u objetos: el conductor la confirma al recoger. */
  bultos?: number;
  peso_kg?: number;
  fragil?: boolean;
  /** Quién entrega la carga en el origen. */
  contacto_origen_nombre?: string;
  contacto_origen_telefono?: string;
  // Trasteo
  objetos?: string;
  pisos_origen?: number;
  pisos_destino?: number;
  ascensor_origen?: boolean;
  ascensor_destino?: boolean;
  ayudantes?: number;
  // Mercado y mandado
  lista?: string;
  presupuesto?: number;
  // Insumos del campo
  insumo?: string;
  acceso_destapado?: boolean;
}

export interface Extra {
  concepto: string;
  valor: number;
}

export class DetalleInvalido extends Error {}

const texto = (v: unknown, campo: string, max: number, obligatorio = false): string | undefined => {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (obligatorio) throw new DetalleInvalido(`Completa el campo "${campo}"`);
    return undefined;
  }
  const t = String(v).trim();
  if (t.length > max) throw new DetalleInvalido(`"${campo}" admite máximo ${max} caracteres`);
  return t;
};

const entero = (v: unknown, campo: string, min: number, max: number): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new DetalleInvalido(`"${campo}" debe ser un número entre ${min} y ${max}`);
  return n;
};

const booleano = (v: unknown): boolean | undefined => (v === undefined || v === null || v === '' ? undefined : v === true || v === 'true');

export function esTipoServicio(v: unknown): v is TipoServicio {
  return (TIPOS_SERVICIO as readonly unknown[]).includes(v);
}

/** Valida y normaliza el detalle según el tipo de servicio. Lanza DetalleInvalido con un mensaje claro. */
export function detalleValido(tipo: TipoServicio, crudo: unknown): DetalleServicio {
  const v = (crudo && typeof crudo === 'object' ? crudo : {}) as Record<string, unknown>;
  const d: DetalleServicio = {
    bultos: entero(v['bultos'], 'bultos', 1, MAX_BULTOS),
    peso_kg: entero(v['peso_kg'], 'peso aproximado (kg)', 1, PESO_MAXIMO_KG),
    fragil: booleano(v['fragil']),
    contacto_origen_nombre: texto(v['contacto_origen_nombre'], 'quién entrega', 120),
    contacto_origen_telefono: texto(v['contacto_origen_telefono'], 'teléfono de quien entrega', 20),
  };
  if (d.contacto_origen_telefono && !/^\+?\d[\d\s-]{6,18}$/.test(d.contacto_origen_telefono)) {
    throw new DetalleInvalido('El teléfono de quien entrega no es válido');
  }
  if (tipo === 'trasteo') {
    d.objetos = texto(v['objetos'], 'qué vas a trastear', 500, true);
    d.pisos_origen = entero(v['pisos_origen'], 'piso en el origen', 1, MAX_PISOS) ?? 1;
    d.pisos_destino = entero(v['pisos_destino'], 'piso en el destino', 1, MAX_PISOS) ?? 1;
    d.ascensor_origen = booleano(v['ascensor_origen']) ?? false;
    d.ascensor_destino = booleano(v['ascensor_destino']) ?? false;
    d.ayudantes = entero(v['ayudantes'], 'ayudantes', 0, MAX_AYUDANTES) ?? 0;
  }
  if (tipo === 'mercado' || tipo === 'mandado') {
    d.lista = texto(v['lista'], tipo === 'mercado' ? 'lista del mercado' : 'qué hay que hacer', 1000, true);
    d.presupuesto = entero(v['presupuesto'], 'presupuesto', 0, 5_000_000);
  }
  if (tipo === 'insumos') {
    d.insumo = texto(v['insumo'], 'qué insumo llevas', 200, true);
    d.acceso_destapado = booleano(v['acceso_destapado']) ?? false;
    if (d.peso_kg === undefined) throw new DetalleInvalido('Indica el peso aproximado de la carga');
  }
  return Object.fromEntries(Object.entries(d).filter(([, x]) => x !== undefined)) as DetalleServicio;
}

const ORDEN = (c: VehicleCategory) => CATEGORIAS_VEHICULO.indexOf(c);

/** Vehículo más pequeño que puede hacer el servicio con ese peso. */
export function vehiculoMinimo(tipo: TipoServicio, detalle: DetalleServicio): VehicleCategory {
  let minimo = SERVICIOS[tipo].vehiculoMinimo;
  if (detalle.peso_kg !== undefined) {
    const porPeso = CATEGORIAS_VEHICULO.find((c) => CAPACIDAD_KG[c] >= (detalle.peso_kg as number)) ?? 'Furgoneta';
    if (ORDEN(porPeso) > ORDEN(minimo)) minimo = porPeso;
  }
  return minimo;
}

/** Vehículos que pueden hacer el servicio (del mínimo en adelante). */
export function vehiculosParaServicio(tipo: TipoServicio, detalle: DetalleServicio): VehicleCategory[] {
  const min = ORDEN(vehiculoMinimo(tipo, detalle));
  return CATEGORIAS_VEHICULO.filter((c) => ORDEN(c) >= min);
}

/** Recargos fijos del servicio (ayudantes y pisos). La vía destapada se calcula aparte (porcentaje). */
export function extrasServicio(tipo: TipoServicio, detalle: DetalleServicio): Extra[] {
  const extras: Extra[] = [];
  if (tipo === 'trasteo') {
    const ayudantes = detalle.ayudantes ?? 0;
    if (ayudantes > 0) extras.push({ concepto: `${ayudantes} ${ayudantes === 1 ? 'ayudante' : 'ayudantes'}`, valor: ayudantes * VALOR_AYUDANTE });
    const pisos = (p: number | undefined, ascensor: boolean | undefined) => (ascensor ? 0 : Math.max(0, (p ?? 1) - 1));
    const total = pisos(detalle.pisos_origen, detalle.ascensor_origen) + pisos(detalle.pisos_destino, detalle.ascensor_destino);
    if (total > 0) extras.push({ concepto: `Escaleras (${total} ${total === 1 ? 'piso' : 'pisos'})`, valor: total * VALOR_PISO });
  }
  return extras;
}

/** Porcentaje de recargo por vía destapada o finca (0 si no aplica). */
export function recargoAcceso(tipo: TipoServicio, detalle: DetalleServicio): number {
  return tipo === 'insumos' && detalle.acceso_destapado ? RECARGO_DESTAPADO : 0;
}

/** Código de 4 dígitos que quien entrega la carga le da al conductor al recogerla. */
export function generarCodigoRecogida(aleatorio: () => number = Math.random): string {
  return Math.floor(1000 + aleatorio() * 9000).toString();
}
