import request from 'supertest';
import { Express } from 'express';
import { pool } from '../../src/config/database';
import { FUSA, SILVANIA, crearAppPrueba, hayBaseDeDatos, reiniciarBase, sesion, sesionAdmin } from '../helpers/app';

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
let disponible = false;
let app: Express;

beforeAll(async () => {
  disponible = await hayBaseDeDatos();
  if (!disponible) return;
  await reiniciarBase();
  app = crearAppPrueba();
});

afterAll(async () => {
  await pool.end();
});

const conBd = (nombre: string, fn: () => Promise<void>) =>
  it(nombre, async () => {
    if (!disponible) return;
    await fn();
  });

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Conductor aprobado con moto; devuelve su sesión y su id de conductor. */
async function conductorListo(correo: string, placa: string) {
  const s = await sesion(app, correo, 3, 'Camilo Rojas');
  const admin = await sesionAdmin(app);
  const me = (await request(app).get('/api/conductores/me').set(auth(s.token))).body;
  await request(app).post('/api/vehicles/register').set(auth(s.token)).send({ placa, categoria: 'Moto Express' });
  await request(app).post('/api/conductores/aprobar').set(auth(admin.token)).send({ driverId: me.id_conductor, approved: true });
  return { ...s, idConductor: me.id_conductor as number };
}

async function crearEnvio(token: string, extra: Record<string, unknown> = {}) {
  const r = await request(app)
    .post('/api/envios/crear')
    .set(auth(token))
    .send({ origen: 'Casco Urbano', destino: 'Silvania', tipo_carga: 'Documentos', id_zona: 1, ...extra });
  return r.body.envio;
}

describe('Sitio público', () => {
  conBd('estadísticas y zonas sin sesión', async () => {
    const est = await request(app).get('/api/publico/estadisticas');
    expect(est.status).toBe(200);
    expect(est.body).toEqual({ enviosEntregados: 0, conductoresActivos: 0, zonasCubiertas: 5, calificacionPromedio: 0 });
    const zonas = await request(app).get('/api/publico/zonas');
    expect(zonas.body).toHaveLength(5);
    expect(zonas.body[0]).toEqual({ id_zona: 1, nombre_zona: 'Casco Urbano', tarifa_base: 5000 });
  });

  conBd('formulario de contacto: valida, guarda y el administrador lo atiende', async () => {
    const malo = await request(app).post('/api/contacto').send({ nombre: 'Al', correo: 'no-es-correo', mensaje: 'hola' });
    expect(malo.status).toBe(400);
    expect((await request(app).post('/api/contacto').send({ nombre: 'Ana Ruiz', correo: 'ana@x.co', mensaje: 'Quiero cotizar envíos para mi tienda', asunto: 'Otro' })).status).toBe(400);
    const ok = await request(app)
      .post('/api/contacto')
      .send({ nombre: 'Ana Ruiz', correo: 'ANA@x.co', telefono: '310 555-1234', asunto: 'Empresas', mensaje: 'Quiero cotizar envíos para mi tienda' });
    expect(ok.status).toBe(201);
    const admin = await sesionAdmin(app);
    const lista = await request(app).get('/api/admin/contactos?pendientes=true').set(auth(admin.token));
    expect(lista.body.items[0]).toMatchObject({ nombre: 'Ana Ruiz', correo: 'ana@x.co', telefono: '3105551234', asunto: 'Empresas', atendido: false });
    expect((await request(app).post(`/api/admin/contactos/${ok.body.id}/atender`).set(auth(admin.token))).status).toBe(204);
    expect((await request(app).get('/api/admin/contactos?pendientes=true').set(auth(admin.token))).body.total).toBe(0);
    expect((await request(app).post('/api/admin/contactos/999/atender').set(auth(admin.token))).status).toBe(404);
  });
});

describe('Mi cuenta', () => {
  conBd('perfil, actualización y cambio de contraseña', async () => {
    const s = await sesion(app, 'perfil@t.co', 2, 'Laura Méndez');
    const me = await request(app).get('/api/usuarios/me').set(auth(s.token));
    expect(me.body).toMatchObject({ id: s.id, nombre: 'Laura Méndez', correo: 'perfil@t.co', rol: '2', nombre_rol: 'Cliente', telefono: null });
    expect(me.body.fecha_registro).toMatch(/^\d{4}-/);

    const upd = await request(app).patch('/api/usuarios/me').set(auth(s.token)).send({ nombre: '  Laura   Méndez Ríos ', telefono: '+57 310 555 0000' });
    expect(upd.body.usuario).toMatchObject({ nombre: 'Laura Méndez Ríos', telefono: '+573105550000' });
    expect((await request(app).patch('/api/usuarios/me').set(auth(s.token)).send({ telefono: '12' })).status).toBe(400);
    expect((await request(app).patch('/api/usuarios/me').set(auth(s.token)).send({ telefono: '' })).body.usuario.telefono).toBeNull();

    const malActual = await request(app).post('/api/usuarios/me/password').set(auth(s.token)).send({ actual: 'Otra1234', nueva: 'Nueva2026' });
    expect(malActual.status).toBe(400);
    expect(malActual.body.error).toBe('La contraseña actual no es correcta');
    expect((await request(app).post('/api/usuarios/me/password').set(auth(s.token)).send({ actual: 'Clave1234', nueva: 'debil' })).status).toBe(400);
    expect((await request(app).post('/api/usuarios/me/password').set(auth(s.token)).send({ actual: 'Clave1234', nueva: 'Nueva2026' })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ correo: 'perfil@t.co', password: 'Nueva2026' })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ correo: 'perfil@t.co', password: 'Clave1234' })).status).toBe(401);
  });
});

describe('Cancelación de envíos', () => {
  conBd('el cliente cancela solo mientras está Pendiente; el administrador con motivo', async () => {
    const cliente = await sesion(app, 'cancela@t.co', 2);
    const otro = await sesion(app, 'cancela-otro@t.co', 2);
    const conductor = await conductorListo('cancela-con@t.co', 'CAN12D');
    const admin = await sesionAdmin(app);

    const e1 = await crearEnvio(cliente.token);
    expect((await request(app).post(`/api/envios/${e1.id_envio}/cancelar`).set(auth(otro.token))).status).toBe(403);
    expect((await request(app).post(`/api/envios/${e1.id_envio}/cancelar`).set(auth(conductor.token))).status).toBe(403);
    const c1 = await request(app).post(`/api/envios/${e1.id_envio}/cancelar`).set(auth(cliente.token)).send({ motivo: 'Ya no lo necesito' });
    expect(c1.status).toBe(200);
    expect(c1.body.envio).toMatchObject({ estado: 'Cancelado', motivo_cancelacion: 'Ya no lo necesito' });
    expect((await request(app).post(`/api/envios/${e1.id_envio}/cancelar`).set(auth(cliente.token))).status).toBe(400);
    // Cancelado no aparece en el tablero y queda en el historial del cliente
    const tablero = (await request(app).get('/api/conductores/envios/disponibles').set(auth(conductor.token))).body.envios;
    expect(tablero.map((e: { id_envio: number }) => e.id_envio)).not.toContain(e1.id_envio);
    const hist = (await request(app).get('/api/clientes/envios?estado=historial').set(auth(cliente.token))).body.envios;
    expect(hist.map((e: { estado: string }) => e.estado)).toEqual(['Cancelado']);

    // Asignado: el cliente ya no puede; el administrador sí, con motivo, y avisa a ambos
    const e2 = await crearEnvio(cliente.token);
    await request(app).post('/api/envios/aceptar').set(auth(conductor.token)).send({ id_envio: e2.id_envio });
    expect((await request(app).post(`/api/envios/${e2.id_envio}/cancelar`).set(auth(cliente.token))).body.error).toBe(
      'Solo puedes cancelar un envío mientras ningún conductor lo ha tomado',
    );
    expect((await request(app).post(`/api/envios/${e2.id_envio}/cancelar`).set(auth(admin.token)).send({})).status).toBe(400);
    const c2 = await request(app).post(`/api/envios/${e2.id_envio}/cancelar`).set(auth(admin.token)).send({ motivo: 'Dirección inexistente' });
    expect(c2.body.envio.estado).toBe('Cancelado');
    // El conductor queda libre y recibe el aviso
    expect((await request(app).get('/api/conductores/envios/activo').set(auth(conductor.token))).body.envio).toBeNull();
    const avisosCon = (await request(app).get('/api/notificaciones').set(auth(conductor.token))).body.items;
    expect(avisosCon[0]).toMatchObject({ tipo: 'envio_cancelado', titulo: 'Servicio cancelado', id_envio: e2.id_envio });
    const avisosCli = (await request(app).get('/api/notificaciones').set(auth(cliente.token))).body.items;
    expect(avisosCli.map((a: { tipo: string }) => a.tipo)).toEqual(['envio_cancelado', 'envio_aceptado']);
    const aud = await request(app).get('/api/admin/auditoria?accion=Env%C3%ADo%20cancelado').set(auth(admin.token));
    expect(aud.body.total).toBe(2);
  });
});

describe('Seguimiento, notificaciones, reputación y ganancias', () => {
  conBd('recorre el servicio con mapa, ETA, avisos y resumen del conductor', async () => {
    const cliente = await sesion(app, 'segui@t.co', 2, 'Marta Díaz');
    const conductor = await conductorListo('segui-con@t.co', 'SEG12D');
    const admin = await sesionAdmin(app);

    // Cotización con tiempo estimado y envío con notas y coordenadas
    const cot = await request(app).post('/api/cotizar/cotizar').set(auth(cliente.token)).send({ origen: 'Casco Urbano', destino: 'Silvania', id_zona: 1 });
    expect(cot.body).toMatchObject({ duracion_estimada_min: 69, distancia_exacta: true });
    expect((await request(app).post('/api/envios/crear').set(auth(cliente.token)).send({ origen: 'Casco Urbano', destino: 'Silvania', tipo_carga: 'x', id_zona: 1, notas: 'x'.repeat(301) })).status).toBe(400);
    const envio = await crearEnvio(cliente.token, { notas: 'Dejar en portería, preguntar por Juan' });
    expect(envio).toMatchObject({ notas: 'Dejar en portería, preguntar por Juan', distancia_km: 34.5, origen_coords: FUSA, destino_coords: SILVANIA });

    // El tablero muestra la ganancia del conductor (80 % de la tarifa)
    const tablero = (await request(app).get('/api/conductores/envios/disponibles').set(auth(conductor.token))).body.envios;
    expect(tablero.find((e: { id_envio: number }) => e.id_envio === envio.id_envio).ganancia_conductor).toBe(31600);

    // Seguimiento antes de aceptar: sin recorrido ni ETA
    const s0 = (await request(app).get(`/api/envios/${envio.id_envio}/seguimiento`).set(auth(cliente.token))).body;
    expect(s0).toMatchObject({ estado: 'Pendiente', recorrido: [], en_vivo: false, eta_minutos: null, destino: { direccion: 'Silvania', coords: SILVANIA } });

    await request(app).post('/api/envios/aceptar').set(auth(conductor.token)).send({ id_envio: envio.id_envio });
    await request(app).post(`/api/envios/${envio.id_envio}/iniciar-ruta`).set(auth(conductor.token));
    const ahora = Date.now();
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post(`/api/envios/${envio.id_envio}/ubicacion`)
        .set(auth(conductor.token))
        .send({ lat: FUSA.lat + i * 0.01, lon: FUSA.lon - i * 0.005, capturado_en: new Date(ahora - (3 - i) * 10_000).toISOString() });
    }
    const s1 = (await request(app).get(`/api/envios/${envio.id_envio}/seguimiento`).set(auth(cliente.token))).body;
    expect(s1.estado).toBe('En Ruta');
    expect(s1.recorrido).toHaveLength(3);
    expect(s1.recorrido[0].lat).toBeCloseTo(FUSA.lat, 4);
    expect(s1.ultima_ubicacion.lat).toBeCloseTo(FUSA.lat + 0.02, 4);
    expect(s1.en_vivo).toBe(true);
    expect(s1.distancia_restante_km).toBeGreaterThan(5);
    expect(s1.eta_minutos).toBeGreaterThan(5);
    const otro = await sesion(app, 'segui-otro@t.co', 2);
    expect((await request(app).get(`/api/envios/${envio.id_envio}/seguimiento`).set(auth(otro.token))).status).toBe(403);

    // Entrega y calificación con comentario
    const evid = await request(app).post(`/api/envios/${envio.id_envio}/evidencia`).set(auth(conductor.token)).attach('archivo', JPG, { filename: 'f.webp', contentType: 'image/webp' });
    expect(evid.status).toBe(201);
    await request(app).post(`/api/envios/${envio.id_envio}/validar-entrega`).set(auth(conductor.token)).send({ url_foto: evid.body.url_foto, pin_seguridad: envio.pin_seguridad });
    expect((await request(app).post(`/api/envios/${envio.id_envio}/calificar`).set(auth(cliente.token)).send({ rating: 5, comentario: 'y'.repeat(301) })).status).toBe(400);
    const cal = await request(app).post(`/api/envios/${envio.id_envio}/calificar`).set(auth(cliente.token)).send({ rating: 5, comentario: '  Muy puntual  ' });
    expect(cal.body.envio).toMatchObject({ calificacion: 5, comentario: 'Muy puntual' });

    // Notificaciones del cliente: aceptado → en camino → entregado (más reciente primero)
    const avisos = await request(app).get('/api/notificaciones').set(auth(cliente.token));
    expect(avisos.body.no_leidas).toBe(3);
    expect(avisos.body.items.map((a: { tipo: string }) => a.tipo)).toEqual(['envio_entregado', 'ruta_iniciada', 'envio_aceptado']);
    expect((await request(app).get('/api/notificaciones/no-leidas').set(auth(cliente.token))).body).toEqual({ no_leidas: 3 });
    const primero = avisos.body.items[0].id;
    expect((await request(app).post(`/api/notificaciones/${primero}/leer`).set(auth(cliente.token))).status).toBe(204);
    expect((await request(app).post(`/api/notificaciones/${primero}/leer`).set(auth(conductor.token))).status).toBe(404);
    expect((await request(app).get('/api/notificaciones?no_leidas=true').set(auth(cliente.token))).body.items).toHaveLength(2);
    expect((await request(app).post('/api/notificaciones/leer-todas').set(auth(cliente.token))).body).toEqual({ marcadas: 2 });
    // El conductor recibió la aprobación y la calificación
    const avisosCon = (await request(app).get('/api/notificaciones').set(auth(conductor.token))).body.items;
    expect(avisosCon.map((a: { tipo: string }) => a.tipo)).toEqual(['calificacion_recibida', 'conductor_aprobado']);
    expect(avisosCon[0].mensaje).toContain('Muy puntual');

    // Historial y resumen del conductor
    const historial = (await request(app).get('/api/conductores/envios/historial').set(auth(conductor.token))).body.envios;
    expect(historial[0]).toMatchObject({ id_envio: envio.id_envio, estado: 'Entregado', calificacion: 5, comentario: 'Muy puntual', ganancia_conductor: 31600 });
    expect(historial[0].pin_seguridad).toBeUndefined();
    const resumen = (await request(app).get('/api/conductores/me/resumen').set(auth(conductor.token))).body;
    expect(resumen).toEqual({ completados: 1, ingresos_total: 31600, ingresos_mes: 31600, calificacion_promedio: 5, total_calificaciones: 1, servicio_activo: null });
    expect((await request(app).get('/api/conductores/me/resumen').set(auth(cliente.token))).status).toBe(403);

    // Panel de administración: búsqueda de envíos y tarifa de zona
    const todos = await request(app).get('/api/admin/envios?tamano=50').set(auth(admin.token));
    expect(todos.body.total).toBeGreaterThanOrEqual(1);
    const porId = await request(app).get(`/api/admin/envios?texto=${envio.id_envio}`).set(auth(admin.token));
    expect(porId.body.items[0]).toMatchObject({ id_envio: envio.id_envio, cliente: { nombre: 'Marta Díaz', correo: 'segui@t.co' }, conductor_nombre: 'Camilo Rojas', zona: 'Casco Urbano' });
    expect(porId.body.items[0].pin_seguridad).toBeUndefined();
    const entregados = await request(app).get('/api/admin/envios?estado=Entregado&id_zona=1').set(auth(admin.token));
    expect(entregados.body.items.every((e: { estado: string }) => e.estado === 'Entregado')).toBe(true);
    expect((await request(app).get('/api/admin/envios?estado=Raro').set(auth(admin.token))).status).toBe(400);
    expect((await request(app).get('/api/admin/envios').set(auth(cliente.token))).status).toBe(403);

    expect((await request(app).put('/api/admin/zonas/1').set(auth(admin.token)).send({ tarifa_base: -5 })).status).toBe(400);
    expect((await request(app).put('/api/admin/zonas/99').set(auth(admin.token)).send({ tarifa_base: 6000 })).status).toBe(404);
    const zona = await request(app).put('/api/admin/zonas/1').set(auth(admin.token)).send({ tarifa_base: 6000 });
    expect(zona.body.zona).toEqual({ id_zona: 1, nombre_zona: 'Casco Urbano', tarifa_base: 6000 });
    const cot2 = await request(app).post('/api/cotizar/cotizar').set(auth(cliente.token)).send({ origen: 'Casco Urbano', destino: 'Silvania', id_zona: 1 });
    expect(cot2.body.tarifa_total).toBe(40500);

    // Las cifras públicas reflejan la operación
    const met = await request(app).get('/api/admin/dashboard/metrics').set(auth(admin.token));
    expect(met.body.entregados).toBeGreaterThanOrEqual(1);
    expect(typeof met.body.cancelados).toBe('number');
  });
});
