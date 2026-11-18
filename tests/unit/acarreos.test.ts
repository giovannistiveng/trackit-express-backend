import {
  DetalleInvalido,
  RECARGO_DESTAPADO,
  VALOR_AYUDANTE,
  VALOR_PISO,
  detalleValido,
  esTipoServicio,
  extrasServicio,
  generarCodigoRecogida,
  recargoAcceso,
  vehiculoMinimo,
  vehiculosParaServicio,
} from '../../src/domain/services/servicios';
import { calcularTarifaDetallada } from '../../src/domain/services/tarifas';
import {
  REQUISITOS,
  diasParaVencer,
  evaluarRequisitos,
  fechaVencimientoValida,
  ultimoPorTipo,
  venceEl,
} from '../../src/domain/services/verificacion';
import { DocumentoConductor, TipoDocumento } from '../../src/domain/entities/documento-conductor.entity';
import { Envio, etapaDe } from '../../src/domain/entities/shipment.entity';
import { servicioValido } from '../../src/application/services/cotizador';
import {
  CheckDocumentExpiryUseCase,
  DecideDriverApprovalUseCase,
  ReviewDriverDocumentUseCase,
  UploadDriverDocumentUseCase,
  textoVence,
} from '../../src/application/use-cases/drivers/driver.use-cases';
import { TraceRouteUseCase } from '../../src/application/use-cases/catalog/catalog.use-cases';
import { ValidationError } from '../../src/shared/errors';
import { ADMIN, CONDUCTOR, FakeDocumentos, FakeDrivers, FakeVehicles, auditFalso, notificacionesFalsas } from '../helpers/fakes';

const HOY = new Date('2026-11-17T15:00:00Z');
const DIA = 86_400_000;

describe('tipos de servicio', () => {
  it('reconoce los cinco tipos', () => {
    expect(['mandado', 'mercado', 'paquete', 'trasteo', 'insumos'].every(esTipoServicio)).toBe(true);
    expect(esTipoServicio('mudanza')).toBe(false);
  });

  it('el trasteo exige qué se lleva y completa pisos y ayudantes', () => {
    expect(() => detalleValido('trasteo', {})).toThrow('Completa el campo "qué vas a trastear"');
    expect(detalleValido('trasteo', { objetos: 'Nevera y cama', pisos_origen: '3', ayudantes: 2, bultos: 12 })).toEqual({
      objetos: 'Nevera y cama',
      pisos_origen: 3,
      pisos_destino: 1,
      ascensor_origen: false,
      ascensor_destino: false,
      ayudantes: 2,
      bultos: 12,
    });
    expect(() => detalleValido('trasteo', { objetos: 'x', ayudantes: 4 })).toThrow('"ayudantes" debe ser un número entre 0 y 3');
    expect(() => detalleValido('trasteo', { objetos: 'x', pisos_destino: 1.5 })).toThrow(DetalleInvalido);
  });

  it('mercado y mandado piden la lista; insumos piden insumo y peso', () => {
    expect(() => detalleValido('mercado', {})).toThrow('lista del mercado');
    expect(() => detalleValido('mandado', { lista: '' })).toThrow('qué hay que hacer');
    expect(detalleValido('mercado', { lista: 'Arroz, huevos', presupuesto: 80000 })).toEqual({ lista: 'Arroz, huevos', presupuesto: 80000 });
    expect(() => detalleValido('insumos', { insumo: 'Abono' })).toThrow('Indica el peso aproximado');
    expect(detalleValido('insumos', { insumo: 'Abono', peso_kg: 250, acceso_destapado: 'true' })).toEqual({ insumo: 'Abono', peso_kg: 250, acceso_destapado: true });
    expect(() => detalleValido('insumos', { insumo: 'Arena', peso_kg: 9000 })).toThrow('entre 1 y 3500');
  });

  it('valida el contacto en el origen y el largo de los textos', () => {
    expect(detalleValido('paquete', { contacto_origen_nombre: ' Doña Rosa ', contacto_origen_telefono: '310 555 1234', fragil: true })).toEqual({
      contacto_origen_nombre: 'Doña Rosa',
      contacto_origen_telefono: '310 555 1234',
      fragil: true,
    });
    expect(() => detalleValido('paquete', { contacto_origen_telefono: 'abc' })).toThrow('teléfono de quien entrega');
    expect(() => detalleValido('mercado', { lista: 'x'.repeat(1001) })).toThrow('máximo 1000');
    expect(detalleValido('paquete', null)).toEqual({});
  });

  it('el vehículo mínimo depende del servicio y del peso', () => {
    expect(vehiculoMinimo('mandado', {})).toBe('Moto Express');
    expect(vehiculoMinimo('trasteo', { objetos: 'x' })).toBe('Motocarro');
    expect(vehiculoMinimo('insumos', { peso_kg: 20 })).toBe('Moto Express');
    expect(vehiculoMinimo('insumos', { peso_kg: 21 })).toBe('Motocarro');
    expect(vehiculoMinimo('insumos', { peso_kg: 800 })).toBe('Camioneta');
    expect(vehiculoMinimo('trasteo', { peso_kg: 2000 })).toBe('Camión');
    expect(vehiculosParaServicio('trasteo', {})).toEqual(['Motocarro', 'Camioneta', 'Camión']);
  });

  it('suma ayudantes y escaleras sin ascensor; el acceso destapado es un porcentaje', () => {
    expect(extrasServicio('trasteo', { ayudantes: 1, pisos_origen: 3, pisos_destino: 2, ascensor_destino: true })).toEqual([
      { concepto: '1 ayudante', valor: VALOR_AYUDANTE },
      { concepto: 'Escaleras (2 pisos)', valor: 2 * VALOR_PISO },
    ]);
    expect(extrasServicio('trasteo', { ayudantes: 2, pisos_origen: 2 })).toEqual([
      { concepto: '2 ayudantes', valor: 2 * VALOR_AYUDANTE },
      { concepto: 'Escaleras (1 piso)', valor: VALOR_PISO },
    ]);
    expect(extrasServicio('mercado', { ayudantes: 3 })).toEqual([]);
    expect(recargoAcceso('insumos', { acceso_destapado: true })).toBe(RECARGO_DESTAPADO);
    expect(recargoAcceso('paquete', { acceso_destapado: true })).toBe(0);
  });

  it('la tarifa incluye los extras y el acceso antes del recargo nocturno', () => {
    const tarifa = { categoria: 'Motocarro' as const, banderazo: 4000, por_km: 1000, por_minuto: 0, minimo: 0 };
    const d = calcularTarifaDetallada({
      tarifa,
      distanciaKm: 10,
      minutos: 0,
      recargoZona: 0,
      fecha: new Date('2026-11-17T17:00:00Z'),
      extras: [{ concepto: '1 ayudante', valor: 25000 }],
      porcentajeAcceso: 0.15,
    });
    // viaje 14.000 + acceso 2.100 + ayudante 25.000
    expect(d).toMatchObject({ recargo_acceso: 2100, extras: [{ concepto: '1 ayudante', valor: 25000 }], total: 41100 });
    const noche = calcularTarifaDetallada({ tarifa, distanciaKm: 10, minutos: 0, recargoZona: 0, fecha: new Date('2026-11-18T03:00:00Z'), extras: [{ concepto: 'x', valor: 1000 }] });
    expect(noche.recargo_nocturno).toBe(3000);
  });

  it('servicioValido convierte los errores en ValidationError y usa paquete por defecto', () => {
    expect(servicioValido(undefined, undefined)).toEqual({ tipo: 'paquete', detalle: {} });
    expect(() => servicioValido('avion', {})).toThrow('Tipo de servicio inválido');
    expect(() => servicioValido('trasteo', {})).toThrow(ValidationError);
  });

  it('genera códigos de recogida de 4 dígitos', () => {
    expect(generarCodigoRecogida(() => 0)).toBe('1000');
    expect(generarCodigoRecogida(() => 0.9999)).toBe('9999');
    expect(generarCodigoRecogida()).toMatch(/^\d{4}$/);
  });
});

describe('etapas del servicio', () => {
  const base: Envio = { origen: 'A', destino: 'B', tipo_carga: 'x', tarifa: 1, id_cliente: 1, id_zona: 1 };
  it('resume estado y marcas de tiempo en un paso visible', () => {
    const t = new Date();
    expect(etapaDe({ ...base, estado: 'Pendiente' })).toBe('buscando_conductor');
    expect(etapaDe(base)).toBe('buscando_conductor');
    expect(etapaDe({ ...base, estado: 'Asignado' })).toBe('yendo_a_recoger');
    expect(etapaDe({ ...base, estado: 'Asignado', llegada_recogida_en: t })).toBe('en_recogida');
    expect(etapaDe({ ...base, estado: 'En Ruta' })).toBe('en_camino');
    expect(etapaDe({ ...base, estado: 'En Ruta', ida_y_vuelta: true, destino_visitado_en: t })).toBe('regresando');
    expect(etapaDe({ ...base, estado: 'En Ruta', llegada_destino_en: t })).toBe('en_destino');
    expect(etapaDe({ ...base, estado: 'Entregado' })).toBe('entregado');
    expect(etapaDe({ ...base, estado: 'Cancelado' })).toBe('cancelado');
  });
});

const doc = (tipo: TipoDocumento, extra: Partial<DocumentoConductor> = {}): DocumentoConductor => ({
  id: Math.floor(Math.random() * 1e6),
  tipo_documento: tipo,
  url_archivo: 'http://x/' + tipo,
  id_conductor: 1,
  fecha_subida: new Date(HOY.getTime() - DIA),
  estado: 'Aprobado',
  ...extra,
});
const enDias = (n: number) => new Date(Date.UTC(HOY.getUTCFullYear(), HOY.getUTCMonth(), HOY.getUTCDate()) + n * DIA);
const completos = () => [
  doc('Cédula'),
  doc('Selfie'),
  doc('Licencia', { fecha_vencimiento: enDias(400) }),
  doc('SOAT', { fecha_vencimiento: enDias(100) }),
  doc('Tarjeta de propiedad'),
  doc('Antecedentes'),
];

describe('verificación de conductores', () => {
  it('cada requisito tiene ayuda y los que vencen están marcados', () => {
    expect(REQUISITOS.map((r) => r.tipo)).toEqual(['Cédula', 'Selfie', 'Licencia', 'SOAT', 'Tarjeta de propiedad', 'Tecnomecánica', 'Antecedentes']);
    expect(REQUISITOS.filter((r) => r.vence).map((r) => r.tipo)).toEqual(['Licencia', 'SOAT', 'Tecnomecánica']);
    expect(REQUISITOS.every((r) => r.ayuda.length > 10)).toBe(true);
  });

  it('usa el documento más reciente de cada tipo', () => {
    const viejo = doc('SOAT', { fecha_subida: new Date(0), estado: 'Rechazado' });
    const nuevo = doc('SOAT', { fecha_subida: HOY, estado: 'Pendiente' });
    expect(ultimoPorTipo([viejo, nuevo]).get('SOAT')).toBe(nuevo);
  });

  it('calcula días para vencer; los antecedentes duran un año desde que se suben', () => {
    expect(diasParaVencer(doc('SOAT', { fecha_vencimiento: enDias(0) }), HOY)).toBe(0);
    expect(diasParaVencer(doc('SOAT', { fecha_vencimiento: enDias(-1) }), HOY)).toBe(-1);
    expect(diasParaVencer(doc('SOAT', { fecha_vencimiento: enDias(15) }), HOY)).toBe(15);
    expect(diasParaVencer(doc('Cédula'), HOY)).toBeNull();
    expect(venceEl(doc('Antecedentes', { fecha_subida: HOY }))?.getTime()).toBe(HOY.getTime() + 365 * DIA);
    expect(venceEl(doc('Antecedentes', { fecha_subida: undefined }))).toBeNull();
  });

  it('completo solo con vehículo y todos los obligatorios aprobados y vigentes', () => {
    expect(evaluarRequisitos(completos(), true, HOY)).toMatchObject({ completo: true, pendientes: [] });
    expect(evaluarRequisitos(completos(), false, HOY).pendientes).toEqual(['Registra tu vehículo']);
    const sinNada = evaluarRequisitos([], true, HOY);
    expect(sinNada.completo).toBe(false);
    // La tecnomecánica es opcional: si no se sube no bloquea
    expect(sinNada.pendientes).toHaveLength(6);
    const conProblemas = [
      ...completos().filter((d) => !['SOAT', 'Selfie', 'Licencia'].includes(d.tipo_documento)),
      doc('SOAT', { fecha_vencimiento: enDias(-2) }),
      doc('Selfie', { estado: 'Rechazado', motivo_rechazo: 'No se ve la cara' }),
      doc('Licencia', { estado: 'Pendiente', fecha_vencimiento: enDias(30) }),
      doc('Tecnomecánica', { estado: 'Pendiente', fecha_vencimiento: enDias(30) }),
    ];
    const ev = evaluarRequisitos(conProblemas, true, HOY);
    expect(ev.pendientes).toEqual([
      'Corrige: Selfie con la cédula (No se ve la cara)',
      'En revisión: Licencia de conducción',
      'Renueva: SOAT',
      'En revisión: Revisión técnico-mecánica',
    ]);
    expect(ev.items.find((i) => i.tipo === 'SOAT')).toMatchObject({ estado: 'vencido', dias_para_vencer: -2 });
  });

  it('acepta fechas de vencimiento futuras con formato AAAA-MM-DD', () => {
    expect(fechaVencimientoValida('2027-01-31', HOY)?.toISOString()).toBe('2027-01-31T00:00:00.000Z');
    expect(fechaVencimientoValida('2026-11-17', HOY)).not.toBeNull();
    expect(fechaVencimientoValida('2026-11-16', HOY)).toBeNull();
    expect(fechaVencimientoValida('31/01/2027', HOY)).toBeNull();
    expect(fechaVencimientoValida('2027-02-30x', HOY)).toBeNull();
    expect(fechaVencimientoValida('2060-01-01', HOY)).toBeNull();
    expect(fechaVencimientoValida(undefined, HOY)).toBeNull();
  });

  it('textos de vencimiento', () => {
    expect(textoVence(0)).toBe('Vence hoy');
    expect(textoVence(1)).toBe('Vence en 1 día');
    expect(textoVence(9)).toBe('Vence en 9 días');
  });
});

describe('casos de uso de verificación', () => {
  const archivo = { buffer: Buffer.from('x'), originalname: 'f.jpg', mimetype: 'image/jpeg', size: 1 };
  const storage = { upload: async () => 'http://x/doc.jpg' };

  function montar() {
    const drivers = new FakeDrivers();
    drivers.conductores.push({ id_conductor: 1, id_usuario: 20, nombre: 'Camilo', correo: 'c@t.co', estado_aprobacion: 'Aprobado' });
    const documentos = new FakeDocumentos();
    const vehicles = new FakeVehicles();
    const { audit } = auditFalso();
    const notif = notificacionesFalsas();
    return { drivers, documentos, vehicles, audit, notif };
  }

  it('subir exige la fecha de vencimiento donde aplica y reactiva a un suspendido', async () => {
    const m = montar();
    m.drivers.conductores[0].estado_aprobacion = 'Suspendido';
    const uc = new UploadDriverDocumentUseCase(m.documentos, m.drivers, storage, m.audit, () => HOY);
    await expect(uc.execute(CONDUCTOR, { tipo_documento: 'SOAT' }, archivo)).rejects.toThrow('Indica la fecha de vencimiento de: SOAT');
    await expect(uc.execute(CONDUCTOR, { tipo_documento: 'SOAT', fecha_vencimiento: '2020-01-01' }, archivo)).rejects.toThrow('debe estar vigente');
    const r = await uc.execute(CONDUCTOR, { tipo_documento: 'SOAT', fecha_vencimiento: '2027-03-01' }, archivo);
    expect(r).toMatchObject({ tipo_documento: 'SOAT', estado: 'Pendiente', fecha_vencimiento: '2027-03-01' });
    expect(m.drivers.conductores[0].estado_aprobacion).toBe('Pendiente');
    // La selfie no vence: no pide fecha
    expect(await uc.execute(CONDUCTOR, { tipo_documento: 'Selfie' }, archivo)).toMatchObject({ fecha_vencimiento: null });
  });

  it('revisar: motivo obligatorio al rechazar, fecha antes de aprobar lo que vence y aviso al conductor', async () => {
    const m = montar();
    const uc = new ReviewDriverDocumentUseCase(m.documentos, m.drivers, m.audit, m.notif.servicio, () => HOY);
    const selfie = await m.documentos.create({ tipo_documento: 'Selfie', url_archivo: 'u', id_conductor: 1 });
    const soat = await m.documentos.create({ tipo_documento: 'SOAT', url_archivo: 'u', id_conductor: 1 });
    await expect(uc.execute(ADMIN, selfie.id, { aprobado: 'si' })).rejects.toThrow('"aprobado"');
    await expect(uc.execute(ADMIN, selfie.id, { aprobado: false, motivo: 'x' })).rejects.toThrow('Escribe el motivo');
    await expect(uc.execute(ADMIN, 999, { aprobado: true })).rejects.toThrow('No existe el documento');
    await expect(uc.execute(ADMIN, soat.id, { aprobado: true })).rejects.toThrow('Indica la fecha de vencimiento');
    await expect(uc.execute(ADMIN, soat.id, { aprobado: true, fecha_vencimiento: 'mañana' })).rejects.toThrow('no es válida');
    expect(await uc.execute(ADMIN, soat.id, { aprobado: true, fecha_vencimiento: '2027-05-01' })).toMatchObject({ estado: 'Aprobado', fecha_vencimiento: '2027-05-01' });
    expect(await uc.execute(ADMIN, selfie.id, { aprobado: false, motivo: 'La foto está borrosa' })).toMatchObject({ estado: 'Rechazado', motivo_rechazo: 'La foto está borrosa' });
    expect(m.notif.repo.avisos.at(-1)).toMatchObject({ id_usuario: 20, tipo: 'documento_revisado', titulo: 'Corrige tu Selfie con la cédula' });
    const huerfano = await m.documentos.create({ tipo_documento: 'Selfie', url_archivo: 'u', id_conductor: 77 });
    await expect(uc.execute(ADMIN, huerfano.id, { aprobado: true })).rejects.toThrow('no pertenece');
  });

  it('aprobar exige requisitos completos', async () => {
    const m = montar();
    m.drivers.conductores[0].estado_aprobacion = 'Pendiente';
    const uc = new DecideDriverApprovalUseCase(m.drivers, m.audit, m.notif.servicio, m.documentos, m.vehicles, () => HOY);
    await expect(uc.execute(ADMIN, { driverId: 1, approved: true })).rejects.toThrow(/^Aún no se puede aprobar: Registra tu vehículo; Sube: Cédula/);
    await m.vehicles.create({ placa: 'ABC12D', categoria: 'Moto Express', id_conductor: 1 });
    for (const d of completos()) m.documentos.docs.push({ ...d, id_conductor: 1 });
    expect((await uc.execute(ADMIN, { driverId: 1, approved: true })).estado_aprobacion).toBe('Aprobado');
  });

  it('control diario: suspende si algo venció y avisa una sola vez si vence pronto', async () => {
    const m = montar();
    m.drivers.conductores.push({ id_conductor: 2, id_usuario: 21, nombre: 'Ana', correo: 'a2@t.co', estado_aprobacion: 'Aprobado' });
    m.drivers.conductores.push({ id_conductor: 3, id_usuario: 30, nombre: 'Leo', correo: 'a3@t.co', estado_aprobacion: 'Rechazado' });
    m.documentos.docs.push(doc('SOAT', { id: 1, id_conductor: 1, fecha_vencimiento: enDias(-1) }));
    m.documentos.docs.push(doc('Licencia', { id: 2, id_conductor: 2, fecha_vencimiento: enDias(10) }));
    m.documentos.docs.push(doc('SOAT', { id: 3, id_conductor: 2, fecha_vencimiento: enDias(200) }));
    m.documentos.docs.push(doc('SOAT', { id: 4, id_conductor: 3, fecha_vencimiento: enDias(-30) }));
    const uc = new CheckDocumentExpiryUseCase(m.documentos, m.drivers, m.audit, m.notif.servicio, () => HOY);
    expect(await uc.execute()).toEqual({ suspendidos: 1, avisados: 1 });
    expect(m.drivers.conductores[0]).toMatchObject({ estado_aprobacion: 'Suspendido', motivo_rechazo: 'Documento vencido: SOAT' });
    expect(m.notif.repo.avisos.map((n: { id_usuario: number; tipo: string }) => [n.id_usuario, n.tipo])).toEqual([
      [20, 'conductor_suspendido'],
      [21, 'documento_por_vencer'],
    ]);
    expect(m.notif.repo.avisos[1].mensaje).toBe('Vence en 10 días. Súbelo renovado para no quedar en pausa.');
    // Segunda pasada: ya no repite el aviso ni vuelve a suspender
    expect(await uc.execute()).toEqual({ suspendidos: 0, avisados: 0 });
  });
});

describe('ruta para el mapa', () => {
  it('valida los puntos y delega en el adaptador', async () => {
    const rutas = { trazarRuta: jest.fn(async (p) => ({ km: 1, minutos: 2, puntos: p, exacta: true })) };
    const uc = new TraceRouteUseCase(rutas);
    await expect(uc.execute('4.3,-74.3')).rejects.toThrow('entre 2 y 6 puntos');
    await expect(uc.execute(undefined)).rejects.toThrow('entre 2 y 6 puntos');
    await expect(uc.execute('1,1;2,2;3,3;4,4;5,5;6,6;7,7')).rejects.toThrow('entre 2 y 6 puntos');
    await expect(uc.execute('4.3,-74.3;95,1')).rejects.toThrow('puntos[1].lat');
    expect(await uc.execute('4.3,-74.3; 4.4,-74.4')).toMatchObject({ km: 1, puntos: [{ lat: 4.3, lon: -74.3 }, { lat: 4.4, lon: -74.4 }] });
  });
});
