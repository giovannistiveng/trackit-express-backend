import request from 'supertest';
import { Express } from 'express';
import { pool } from '../../src/config/database';
import { crearAppPrueba, hayBaseDeDatos, reiniciarBase, sesion, sesionAdmin } from '../helpers/app';

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
let disponible = false;
let app: Express;

beforeAll(async () => {
  disponible = await hayBaseDeDatos();
  if (!disponible) {
    console.warn('⚠ Sin PostgreSQL de pruebas: se omiten las pruebas de integración (configura TEST_DB_NAME o TEST_DATABASE_URL)');
    return;
  }
  await reiniciarBase();
  app = crearAppPrueba();
});

afterAll(async () => {
  await pool.end();
});

/** Ejecuta la prueba solo si hay base de datos. */
const conBd = (nombre: string, fn: () => Promise<void>) =>
  it(nombre, async () => {
    if (!disponible) return;
    await fn();
  });

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Sistema y documentación', () => {
  conBd('GET /health informa la base de datos', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', baseDatos: 'ok' });
    expect(r.headers['x-request-id']).toMatch(/^[0-9a-f]{8}$/);
  });

  conBd('Swagger sirve la UI y el JSON con todas las rutas', async () => {
    const ui = await request(app).get('/api/docs/');
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('swagger-ui');
    const spec = await request(app).get('/api/docs.json');
    expect(spec.body.openapi).toBe('3.0.3');
    expect(Object.keys(spec.body.paths)).toEqual(
      expect.arrayContaining(['/api/conductores/me', '/api/zonas', '/api/clientes/envios', '/api/admin/auditoria', '/api/envios/{id}/iniciar-ruta']),
    );
  });

  conBd('rutas inexistentes y JSON mal formado responden con { error }', async () => {
    expect((await request(app).get('/api/no-existe')).status).toBe(404);
    const r = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{malo');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('El cuerpo de la petición no es un JSON válido');
  });
});

describe('Autenticación y roles', () => {
  conBd('registra cliente y conductor; el conductor nace con perfil Pendiente', async () => {
    const c = await request(app).post('/api/auth/register').send({ nombre: 'Ana Gómez', correo: 'Ana@T.co', password: 'Clave1234', id_rol: 2 });
    expect(c.status).toBe(201);
    expect(c.body.user).toEqual({ id: expect.any(Number), correo: 'ana@t.co', nombre: 'Ana Gómez' });
    const { token } = await sesion(app, 'cond-a@t.co', 3, 'Camilo Rojas');
    const me = await request(app).get('/api/conductores/me').set(auth(token));
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ id_conductor: expect.any(Number), estado_aprobacion: 'Pendiente', motivo_rechazo: null, vehiculo: null });
  });

  conBd('rechaza correo duplicado, contraseña débil y el rol Administrador', async () => {
    const dup = await request(app).post('/api/auth/register').send({ nombre: 'Otra', correo: 'ana@t.co', password: 'Clave1234', id_rol: 2 });
    expect(dup.body.error).toBe('El correo ya está registrado');
    const debil = await request(app).post('/api/auth/register').send({ nombre: 'Otra', correo: 'x@t.co', password: 'clave', id_rol: 2 });
    expect(debil.status).toBe(400);
    const admin = await request(app).post('/api/auth/register').send({ nombre: 'Otra', correo: 'y@t.co', password: 'Clave1234', id_rol: 1 });
    expect(admin.body.error).toBe('Solo se pueden registrar cuentas de Cliente o Conductor');
  });

  conBd('el login devuelve token y rol; credenciales malas dan 401 sin revelar cuál falló', async () => {
    const ok = await request(app).post('/api/auth/login').send({ correo: 'ana@t.co', password: 'Clave1234' });
    expect(ok.body.user.rol).toBe('2');
    expect(ok.body.token.split('.')).toHaveLength(3);
    const malo = await request(app).post('/api/auth/login').send({ correo: 'ana@t.co', password: 'Mala1234' });
    expect(malo.status).toBe(401);
    expect(malo.body.error).toBe('Credenciales inválidas');
    const admin = await sesionAdmin(app);
    expect(admin.token).toBeTruthy();
  });

  conBd('sin token da 401, con token inválido 401 y con otro rol 403', async () => {
    expect((await request(app).get('/api/zonas')).status).toBe(401);
    expect((await request(app).get('/api/zonas').set(auth('x.y.z'))).status).toBe(401);
    const { token } = await sesion(app, 'ana@t.co', 2);
    const r = await request(app).get('/api/conductores/pendientes').set(auth(token));
    expect(r.status).toBe(403);
  });
});

describe('Flujo completo: cliente → conductor → entrega → calificación → administración', () => {
  conBd('recorre todos los casos de uso con autorización real', async () => {
    const cliente = await sesion(app, 'cliente@t.co', 2, 'Luisa Pérez');
    const otroCliente = await sesion(app, 'otro@t.co', 2, 'Otro Cliente');
    const conductor = await sesion(app, 'conductor@t.co', 3, 'Jhon Castañeda');
    const otroConductor = await sesion(app, 'conductor2@t.co', 3, 'Pedro Ruiz');
    const admin = await sesionAdmin(app);

    // Zonas y cotización (CU-005)
    const zonas = await request(app).get('/api/zonas').set(auth(cliente.token));
    expect(zonas.body).toHaveLength(5);
    const cot = await request(app).post('/api/cotizar/cotizar').set(auth(cliente.token)).send({ origen: 'Casco Urbano', destino: 'Silvania', id_zona: 1 });
    expect(cot.body).toMatchObject({ distancia_km: 34.5, tarifa_base: 5000, tarifa_total: 39500, moneda: 'COP' });
    expect((await request(app).post('/api/cotizar/cotizar').set(auth(cliente.token)).send({ origen: 'Pasca', destino: 'pasca', id_zona: 1 })).status).toBe(400);
    expect((await request(app).post('/api/cotizar/cotizar').set(auth(cliente.token)).send({ origen: 'Pasca', destino: 'Silvania', id_zona: 99 })).status).toBe(404);

    // Crear envío (CU-006): el cliente sale del token
    const crear = await request(app)
      .post('/api/envios/crear')
      .set(auth(cliente.token))
      .send({ origen: 'Casco Urbano', destino: 'Silvania', tipo_carga: 'Documentos', id_zona: 1, categoria: 'Moto Express' });
    expect(crear.status).toBe(201);
    const envio = crear.body.envio;
    expect(envio).toMatchObject({ estado: 'Pendiente', tarifa: 39500, id_cliente: cliente.id, categoria: 'Moto Express' });
    expect(envio.pin_seguridad).toMatch(/^\d{4}$/);
    const suplantar = await request(app).post('/api/envios/crear').set(auth(cliente.token)).send({ origen: 'A1b', destino: 'B2c', tipo_carga: 'x', id_zona: 1, id_cliente: otroCliente.id });
    expect(suplantar.status).toBe(403);

    // Historial del cliente con filtros
    const mios = await request(app).get('/api/clientes/envios?estado=activos').set(auth(cliente.token));
    expect(mios.body.envios.map((e: { id_envio: number }) => e.id_envio)).toEqual([envio.id_envio]);
    expect((await request(app).get('/api/clientes/envios?estado=historial').set(auth(cliente.token))).body.envios).toEqual([]);
    expect((await request(app).get('/api/clientes/envios?estado=Raro').set(auth(cliente.token))).status).toBe(400);

    // Trazabilidad: dueño ve el PIN, otro cliente no tiene acceso
    const traza = await request(app).get(`/api/envios/${envio.id_envio}`).set(auth(cliente.token));
    expect(traza.body.envio.pin_seguridad).toBe(envio.pin_seguridad);
    expect(traza.body.envio.historial_estado).toHaveLength(1);
    expect((await request(app).get(`/api/envios/${envio.id_envio}`).set(auth(otroCliente.token))).status).toBe(403);
    expect((await request(app).get('/api/envios/abc').set(auth(cliente.token))).status).toBe(400);
    expect((await request(app).get('/api/envios/9999').set(auth(cliente.token))).status).toBe(404);

    // Conductor sin aprobar no ve el tablero
    expect((await request(app).get('/api/conductores/envios/disponibles').set(auth(conductor.token))).status).toBe(403);

    // Vehículo (CU-003) y documento (CU-004)
    const veh = await request(app).post('/api/vehicles/register').set(auth(conductor.token)).send({ placa: ' abc-12d ', categoria: 'Moto Express' });
    expect(veh.status).toBe(201);
    expect(veh.body.vehicle).toMatchObject({ placa: 'ABC12D', categoria: 'Moto Express' });
    expect((await request(app).post('/api/vehicles/register').set(auth(otroConductor.token)).send({ placa: 'ABC12D', categoria: 'Camioneta' })).body.error).toBe(
      'La placa ya está registrada',
    );
    expect((await request(app).post('/api/vehicles/register').set(auth(conductor.token)).send({ placa: 'AB1234', categoria: 'Camioneta' })).status).toBe(400);
    const doc = await request(app).post('/api/documentos/upload').set(auth(conductor.token)).field('tipo_documento', 'Cédula').attach('archivo', JPG, { filename: 'c.jpg', contentType: 'image/jpeg' });
    expect(doc.status).toBe(201);
    expect(doc.body.documento.url_archivo).toMatch(/^http:\/\/localhost:3000\/uploads\/trackit\/documentos\/\d+\/.+\.jpg$/);
    const txt = await request(app).post('/api/documentos/upload').set(auth(conductor.token)).field('tipo_documento', 'SOAT').attach('archivo', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(txt.body.error).toBe('Solo se permiten imágenes o PDF');
    const grande = await request(app).post('/api/documentos/upload').set(auth(conductor.token)).field('tipo_documento', 'SOAT').attach('archivo', Buffer.alloc(5 * 1024 * 1024 + 10), { filename: 'g.jpg', contentType: 'image/jpeg' });
    expect(grande.body.error).toBe('El archivo supera el tamaño máximo de 5 MB');

    // Aprobación (CU-011): pendientes con documentos, rechazo con motivo y aprobación
    const pend = await request(app).get('/api/conductores/pendientes').set(auth(admin.token));
    const yo = pend.body.find((p: { correo: string }) => p.correo === 'conductor@t.co');
    expect(yo.documentos).toEqual([{ tipo_documento: 'Cédula', url_archivo: doc.body.documento.url_archivo }]);
    expect((await request(app).post('/api/conductores/aprobar').set(auth(admin.token)).send({ driverId: yo.id_conductor, approved: false })).status).toBe(400);
    const rechazo = await request(app).post('/api/conductores/aprobar').set(auth(admin.token)).send({ driverId: yo.id_conductor, approved: false, observation: 'Falta el SOAT' });
    expect(rechazo.body.driver).toMatchObject({ estado_aprobacion: 'Rechazado', motivo_rechazo: 'Falta el SOAT' });
    expect((await request(app).get('/api/conductores/me').set(auth(conductor.token))).body.motivo_rechazo).toBe('Falta el SOAT');
    const aprob = await request(app).post('/api/conductores/aprobar').set(auth(admin.token)).send({ driverId: yo.id_conductor, approved: true });
    expect(aprob.body.driver.estado_aprobacion).toBe('Aprobado');
    expect((await request(app).post('/api/conductores/aprobar').set(auth(admin.token)).send({ driverId: yo.id_conductor, approved: true })).body.error).toBe(
      'Este conductor ya ha sido aprobado previamente',
    );
    expect((await request(app).post('/api/conductores/aprobar').set(auth(admin.token)).send({ driverId: 999, approved: true })).status).toBe(404);

    // Tablero (CU-007): sin PIN; el conductor aprobado puede ver el envío disponible
    const tablero = await request(app).get('/api/conductores/envios/disponibles').set(auth(conductor.token));
    expect(tablero.body.envios.map((e: { id_envio: number }) => e.id_envio)).toContain(envio.id_envio);
    expect(tablero.body.envios[0].pin_seguridad).toBeUndefined();
    const vista = await request(app).get(`/api/envios/${envio.id_envio}`).set(auth(conductor.token));
    expect(vista.status).toBe(200);
    expect(vista.body.envio.pin_seguridad).toBeUndefined();

    // Aceptar: el otro conductor (no aprobado) no puede; el aprobado sí
    expect((await request(app).post('/api/envios/aceptar').set(auth(otroConductor.token)).send({ id_envio: envio.id_envio })).status).toBe(403);
    const acepta = await request(app).post('/api/envios/aceptar').set(auth(conductor.token)).send({ id_envio: envio.id_envio });
    expect(acepta.status).toBe(200);
    expect(acepta.body.envio).toMatchObject({ estado: 'Asignado', id_conductor: yo.id_conductor });
    expect(acepta.body.envio.pin_seguridad).toBeUndefined();
    expect((await request(app).post('/api/envios/aceptar').set(auth(conductor.token)).send({ id_envio: envio.id_envio })).body.error).toBe(
      'El envío ya está en estado Asignado y no se puede asignar',
    );
    const activo = await request(app).get('/api/conductores/envios/activo').set(auth(conductor.token));
    expect(activo.body.envio.id_envio).toBe(envio.id_envio);

    // RN_OP_002: con un servicio activo no puede aceptar otro
    const segundo = (await request(app).post('/api/envios/crear').set(auth(cliente.token)).send({ origen: 'Vereda Pekín', destino: 'Pasca', tipo_carga: 'Acarreo', id_zona: 2 })).body.envio;
    expect((await request(app).post('/api/envios/aceptar').set(auth(conductor.token)).send({ id_envio: segundo.id_envio })).body.error).toBe(
      'Ya tienes un servicio activo. Termínalo antes de aceptar otro',
    );

    // Entrega antes de iniciar ruta: rechazada
    expect((await request(app).post(`/api/envios/${envio.id_envio}/validar-entrega`).set(auth(conductor.token)).send({ url_foto: 'https://x/y.jpg', pin_seguridad: envio.pin_seguridad })).body.error).toBe(
      'Inicia la ruta antes de validar la entrega',
    );

    // Iniciar ruta y ubicación (CU-008)
    expect((await request(app).post(`/api/envios/${envio.id_envio}/iniciar-ruta`).set(auth(otroConductor.token))).status).toBe(403);
    const ruta = await request(app).post(`/api/envios/${envio.id_envio}/iniciar-ruta`).set(auth(conductor.token));
    expect(ruta.body.envio.estado).toBe('En Ruta');
    expect((await request(app).post(`/api/envios/${envio.id_envio}/iniciar-ruta`).set(auth(conductor.token))).status).toBe(400);
    const ub = { lat: 4.3369, lon: -74.3638, capturado_en: '2026-10-29T15:00:00.000Z' };
    expect((await request(app).post(`/api/envios/${envio.id_envio}/ubicacion`).set(auth(conductor.token)).send(ub)).status).toBe(201);
    expect((await request(app).post(`/api/envios/${envio.id_envio}/ubicacion`).set(auth(conductor.token)).send(ub)).status).toBe(201); // duplicado ignorado
    expect((await request(app).post(`/api/envios/${envio.id_envio}/ubicacion`).set(auth(conductor.token)).send({ lat: 95, lon: 0 })).status).toBe(400);
    const ultima = await request(app).get(`/api/envios/${envio.id_envio}/ubicacion`).set(auth(cliente.token));
    expect(ultima.body).toEqual({ lat: 4.3369, lon: -74.3638, capturado_en: '2026-10-29T15:00:00.000Z' });
    expect((await request(app).get(`/api/envios/${envio.id_envio}/ubicacion`).set(auth(otroCliente.token))).status).toBe(403);
    expect((await request(app).get(`/api/envios/${segundo.id_envio}/ubicacion`).set(auth(cliente.token))).body).toBeNull();

    // Evidencia y validación de entrega (CU-009)
    const evid = await request(app).post(`/api/envios/${envio.id_envio}/evidencia`).set(auth(conductor.token)).attach('archivo', JPG, { filename: 'f.jpg', contentType: 'image/jpeg' });
    expect(evid.status).toBe(201);
    expect(evid.body.url_foto).toMatch(/\/uploads\/trackit\/evidencias\//);
    const pdf = await request(app).post(`/api/envios/${envio.id_envio}/evidencia`).set(auth(conductor.token)).attach('archivo', Buffer.from('x'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(pdf.body.error).toBe('La foto debe ser JPG o PNG');
    const pinMalo = await request(app).post(`/api/envios/${envio.id_envio}/validar-entrega`).set(auth(conductor.token)).send({ url_foto: evid.body.url_foto, pin_seguridad: '0000' });
    expect(pinMalo.body.error).toBe(envio.pin_seguridad === '0000' ? expect.any(String) : 'PIN incorrecto');
    expect((await request(app).post(`/api/envios/${envio.id_envio}/validar-entrega`).set(auth(conductor.token)).send({ url_foto: 'no-url', pin_seguridad: '1' })).body.error).toBe(
      'La evidencia fotográfica (url_foto) es obligatoria',
    );
    const entrega = await request(app).post(`/api/envios/${envio.id_envio}/validar-entrega`).set(auth(conductor.token)).send({ url_foto: evid.body.url_foto, pin_seguridad: envio.pin_seguridad });
    expect(entrega.body.envio).toMatchObject({ estado: 'Entregado', url_foto: evid.body.url_foto });
    expect((await request(app).post(`/api/envios/${envio.id_envio}/validar-entrega`).set(auth(conductor.token)).send({ url_foto: evid.body.url_foto, pin_seguridad: envio.pin_seguridad })).body.error).toBe(
      'Este envío ya ha sido validado como entregado',
    );
    expect((await request(app).get('/api/conductores/envios/activo').set(auth(conductor.token))).body.envio).toBeNull();

    // Calificación (CU-010)
    expect((await request(app).post(`/api/envios/${segundo.id_envio}/calificar`).set(auth(cliente.token)).send({ rating: 5 })).body.error).toBe(
      'Solo se pueden calificar envíos que ya fueron entregados',
    );
    expect((await request(app).post(`/api/envios/${envio.id_envio}/calificar`).set(auth(otroCliente.token)).send({ rating: 5 })).status).toBe(403);
    expect((await request(app).post(`/api/envios/${envio.id_envio}/calificar`).set(auth(cliente.token)).send({ rating: 4.5 })).status).toBe(400);
    const cal = await request(app).post(`/api/envios/${envio.id_envio}/calificar`).set(auth(cliente.token)).send({ rating: 4 });
    expect(cal.body.envio).toMatchObject({ calificacion: 4, estado: 'Entregado' });
    expect((await request(app).post(`/api/envios/${envio.id_envio}/calificar`).set(auth(cliente.token)).send({ rating: 4 })).body.error).toBe('Este envío ya fue calificado');

    // Reputación: la trazabilidad y el historial informan la calificación y el conductor
    const final = (await request(app).get(`/api/envios/${envio.id_envio}`).set(auth(cliente.token))).body.envio;
    expect(final).toMatchObject({ estado: 'Entregado', calificado: true, calificacion: 4 });
    expect(final.conductor).toEqual({ nombre: 'Jhon Castañeda', placa: 'ABC12D', vehiculo: 'Moto Express', calificacion_promedio: 4 });
    expect(final.historial_estado.map((h: { estado: string }) => h.estado)).toEqual(['Entregado', 'En Ruta', 'Asignado', 'Pendiente']);
    const hist = await request(app).get('/api/clientes/envios?estado=historial').set(auth(cliente.token));
    expect(hist.body.envios[0]).toMatchObject({ calificado: true, conductor: { placa: 'ABC12D' } });

    // Administración: métricas y auditoría
    const met = await request(app).get('/api/admin/dashboard/metrics').set(auth(admin.token));
    expect(met.body).toMatchObject({ enviosTotales: 2, entregados: 1, enviosActivos: 1, ingresosCop: 39500, calificacionPromedio: 4, conductoresAprobados: 1 });
    expect(met.body.porZona).toHaveLength(5);
    expect(met.body.porEstado.map((e: { estado: string }) => e.estado)).toEqual(['Pendiente', 'Asignado', 'En Ruta', 'Entregado']);
    const aud = await request(app).get('/api/admin/auditoria?tamano=5').set(auth(admin.token));
    expect(aud.body.total).toBeGreaterThan(10);
    expect(aud.body.items).toHaveLength(5);
    const filtro = await request(app).get('/api/admin/auditoria?accion=Entrega%20validada').set(auth(admin.token));
    expect(filtro.body.items).toEqual([expect.objectContaining({ usuario: 'conductor@t.co', accion: 'Entrega validada', entidad: 'Envío' })]);
    const texto = await request(app).get('/api/admin/auditoria?texto=SOAT&pagina=1').set(auth(admin.token));
    expect(texto.body.items[0].accion).toBe('Conductor rechazado');
    const lejos = await request(app).get('/api/admin/auditoria?pagina=99&tamano=50').set(auth(admin.token));
    expect(lejos.body.items).toEqual([]);
    expect(lejos.body.total).toBeGreaterThan(10);
  });

  conBd('un envío con categoría solo lo ve y acepta un conductor con ese vehículo', async () => {
    const cliente = await sesion(app, 'cat-cli@t.co', 2);
    const conductor = await sesion(app, 'cat-con@t.co', 3);
    const admin = await sesionAdmin(app);
    const me = (await request(app).get('/api/conductores/me').set(auth(conductor.token))).body;
    await request(app).post('/api/conductores/aprobar').set(auth(admin.token)).send({ driverId: me.id_conductor, approved: true });
    await request(app).post('/api/vehicles/register').set(auth(conductor.token)).send({ placa: 'XYZ123', categoria: 'Camioneta' });
    const moto = (await request(app).post('/api/envios/crear').set(auth(cliente.token)).send({ origen: 'Casco', destino: 'Pasca', tipo_carga: 'Documentos', id_zona: 5, categoria: 'Moto Express' })).body.envio;
    const libre = (await request(app).post('/api/envios/crear').set(auth(cliente.token)).send({ origen: 'Casco', destino: 'Pasca', tipo_carga: 'Documentos', id_zona: 5 })).body.envio;
    const ids = (await request(app).get('/api/conductores/envios/disponibles').set(auth(conductor.token))).body.envios.map((e: { id_envio: number }) => e.id_envio);
    expect(ids).toContain(libre.id_envio);
    expect(ids).not.toContain(moto.id_envio);
    expect((await request(app).post('/api/envios/aceptar').set(auth(conductor.token)).send({ id_envio: moto.id_envio })).body.error).toBe('Este envío requiere un vehículo Moto Express');
    expect((await request(app).post('/api/envios/aceptar').set(auth(conductor.token)).send({ id_envio: libre.id_envio, id_conductor: me.id_conductor + 100 })).status).toBe(403);
    expect((await request(app).post('/api/envios/crear').set(auth(cliente.token)).send({ origen: 'Casco', destino: 'Pasca', tipo_carga: 'x', id_zona: 5, categoria: 'Avión' })).status).toBe(400);
  });

  conBd('un conductor rechazado vuelve a revisión al subir un documento', async () => {
    const conductor = await sesion(app, 'rev@t.co', 3);
    const admin = await sesionAdmin(app);
    const me = (await request(app).get('/api/conductores/me').set(auth(conductor.token))).body;
    await request(app).post('/api/conductores/aprobar').set(auth(admin.token)).send({ driverId: me.id_conductor, approved: false, observation: 'Licencia ilegible' });
    await request(app).post('/api/documentos/upload').set(auth(conductor.token)).field('tipo_documento', 'Licencia').attach('archivo', JPG, { filename: 'l.png', contentType: 'image/png' });
    const despues = (await request(app).get('/api/conductores/me').set(auth(conductor.token))).body;
    expect(despues).toMatchObject({ estado_aprobacion: 'Pendiente', motivo_rechazo: null });
  });
});
