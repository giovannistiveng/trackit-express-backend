import { AddressInfo } from 'net';
import request from 'supertest';
import { Express } from 'express';
import { pool } from '../../src/config/database';
import { Contenedor } from '../../src/infrastructure/container';
import { FUSA, SILVANIA, buzon, crearAppPrueba, crearContenedorPrueba, hayBaseDeDatos, nequi, pushEnviados, reiniciarBase, sesion, sesionAdmin } from '../helpers/app';

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PARADA = { direccion: 'Barrio Balmoral, Fusagasugá', coords: { lat: 4.345, lon: -74.37 } };
let disponible = false;
let app: Express;
let c: Contenedor;

beforeAll(async () => {
  disponible = await hayBaseDeDatos();
  if (!disponible) return;
  await reiniciarBase();
  // Reloj real: las liquidaciones y los programados dependen de la fecha de hoy
  c = crearContenedorPrueba(() => new Date());
  app = crearAppPrueba(c);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  nequi.estado = 'pendiente';
  nequi.fallarCobro = false;
  nequi.fallarReembolso = false;
});

const conBd = (nombre: string, fn: () => Promise<void>) =>
  it(nombre, async () => {
    if (!disponible) return;
    await fn();
  });

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const BASE = { origen: 'Parque principal', destino: 'Silvania', tipo_carga: 'Documentos', origen_coords: FUSA, destino_coords: SILVANIA };

async function conductorListo(correo: string, placa: string) {
  const s = await sesion(app, correo, 3, 'Camilo Rojas');
  const admin = await sesionAdmin(app);
  const me = (await request(app).get('/api/conductores/me').set(auth(s.token))).body;
  await request(app).post('/api/vehicles/register').set(auth(s.token)).send({ placa, categoria: 'Camioneta' });
  await request(app).post('/api/conductores/aprobar').set(auth(admin.token)).send({ driverId: me.id_conductor, approved: true });
  return s;
}

async function crear(token: string, extra: Record<string, unknown> = {}) {
  return request(app).post('/api/envios/crear').set(auth(token)).send({ ...BASE, ...extra });
}

const tablero = async (token: string) =>
  ((await request(app).get('/api/conductores/envios/disponibles').set(auth(token))).body.envios as { id_envio: number }[]).map((e) => e.id_envio);

async function entregar(conductor: string, envio: { id_envio: number; pin_seguridad: string }, extra: Record<string, unknown> = {}) {
  await request(app).post('/api/envios/aceptar').set(auth(conductor)).send({ id_envio: envio.id_envio });
  await request(app).post(`/api/envios/${envio.id_envio}/recogida`).set(auth(conductor)).attach('archivo', JPG, { filename: 'r.jpg', contentType: 'image/jpeg' });
  const evid = await request(app).post(`/api/envios/${envio.id_envio}/evidencia`).set(auth(conductor)).attach('archivo', JPG, { filename: 'e.jpg', contentType: 'image/jpeg' });
  return request(app)
    .post(`/api/envios/${envio.id_envio}/validar-entrega`)
    .set(auth(conductor))
    .send({ url_foto: evid.body.url_foto, pin_seguridad: envio.pin_seguridad, ...extra });
}

describe('Cuenta: verificación de correo y recuperación de contraseña', () => {
  conBd('verifica el correo con el enlace y restablece la contraseña sin revelar cuentas', async () => {
    const correo = 'laura.cuenta@t.co';
    const s = await sesion(app, correo, 2, 'Laura Méndez');
    expect(buzon.enlace(correo)).toMatch(/^http:\/\/localhost:4200\/verificar-correo\?token=/);
    const login = await request(app).post('/api/auth/login').send({ correo, password: 'Clave1234' });
    expect(login.body.user.correo_verificado).toBe(false);
    expect((await request(app).get('/api/usuarios/me').set(auth(s.token))).body.correo_verificado).toBe(false);
    // Reenviar invalida el enlace anterior
    const viejo = buzon.token(correo);
    expect((await request(app).post('/api/usuarios/me/verificacion').set(auth(s.token))).body.enviado).toBe(true);
    expect((await request(app).post('/api/auth/verificar-correo').send({ token: viejo })).status).toBe(400);
    expect((await request(app).post('/api/auth/verificar-correo').send({ token: 'corto' })).body.error).toBe('El enlace no es válido');
    const ok = await request(app).post('/api/auth/verificar-correo').send({ token: buzon.token(correo) });
    expect(ok.body).toMatchObject({ correo_verificado: true });
    expect((await request(app).post('/api/auth/verificar-correo').send({ token: buzon.token(correo) })).status).toBe(400);
    expect((await request(app).post('/api/usuarios/me/verificacion').set(auth(s.token))).body.enviado).toBe(false);

    // Olvidé mi contraseña: misma respuesta exista o no el correo
    const antes = buzon.correos.length;
    const nadie = await request(app).post('/api/auth/olvide-password').send({ correo: 'nadie@t.co' });
    expect(nadie.status).toBe(200);
    expect(buzon.correos.length).toBe(antes);
    expect((await request(app).post('/api/auth/olvide-password').send({ correo: 'x' })).status).toBe(400);
    const pide = await request(app).post('/api/auth/olvide-password').send({ correo: correo.toUpperCase() });
    expect(pide.body.message).toBe(nadie.body.message);
    expect(buzon.enlace(correo)).toMatch(/\/restablecer-contrasena\?token=/);
    const token = buzon.token(correo);
    expect((await request(app).post('/api/auth/restablecer-password').send({ token, nueva: 'debil' })).status).toBe(400);
    expect((await request(app).post('/api/auth/restablecer-password').send({ token, nueva: 'NuevaClave2026' })).status).toBe(200);
    expect(buzon.correos.at(-1)?.asunto).toBe('Tu contraseña de TrackIt Express cambió');
    expect((await request(app).post('/api/auth/restablecer-password').send({ token, nueva: 'OtraClave2026' })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ correo, password: 'Clave1234' })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ correo, password: 'NuevaClave2026' })).status).toBe(200);
  });
});

describe('Pagos con Nequi y efectivo', () => {
  conBd('Nequi: el envío se publica solo cuando el pago se aprueba; rechazo, reintento y cambio a efectivo', async () => {
    const cliente = await sesion(app, 'pagos.cli@t.co', 2, 'Ana Pagos');
    const conductor = await conductorListo('pagos.con@t.co', 'PAG12A');
    expect((await crear(cliente.token, { metodo_pago: 'nequi', telefono_nequi: '123' })).body.error).toMatch(/celular de Nequi/);
    expect((await crear(cliente.token, { metodo_pago: 'tarjeta' })).status).toBe(400);
    const r = await crear(cliente.token, { metodo_pago: 'nequi', telefono_nequi: '+57 310 555 1234' });
    expect(r.status).toBe(201);
    const envio = r.body.envio;
    expect(envio.pago).toMatchObject({ metodo: 'nequi', estado: 'pendiente', telefono: '*** *** 1234' });
    expect(nequi.cobros.at(-1)).toMatchObject({ telefono: '3105551234', monto: envio.tarifa });
    expect(await tablero(conductor.token)).not.toContain(envio.id_envio);
    expect((await request(app).post('/api/envios/aceptar').set(auth(conductor.token)).send({ id_envio: envio.id_envio })).body.error).toBe(
      'Este envío todavía no está disponible para aceptar',
    );
    expect((await request(app).get(`/api/envios/${envio.id_envio}/pago`).set(auth(cliente.token))).body.estado).toBe('pendiente');
    expect((await request(app).get(`/api/envios/${envio.id_envio}/pago`).set(auth(conductor.token))).status).toBe(403);

    nequi.estado = 'aprobado';
    expect((await request(app).get(`/api/envios/${envio.id_envio}/pago`).set(auth(cliente.token))).body).toMatchObject({ estado: 'aprobado', mensaje: 'Pago recibido' });
    expect(await tablero(conductor.token)).toContain(envio.id_envio);
    const avisosCon = (await request(app).get('/api/notificaciones').set(auth(conductor.token))).body.items;
    expect(avisosCon.find((a: { tipo: string; id_envio: number }) => a.tipo === 'nuevo_servicio' && a.id_envio === envio.id_envio).mensaje).toMatch(/Pagado con Nequi/);
    expect((await request(app).get('/api/notificaciones').set(auth(cliente.token))).body.items[0].tipo).toBe('pago_aprobado');
    // Pagado con Nequi: no se pide confirmar efectivo
    const entrega = await entregar(conductor.token, envio);
    expect(entrega.body.envio.estado).toBe('Entregado');
    expect((await request(app).get(`/api/envios/${envio.id_envio}/pago`).set(auth(conductor.token))).body.estado).toBe('aprobado');

    // Rechazo → reintento → efectivo
    nequi.estado = 'rechazado';
    const r2 = (await crear(cliente.token, { metodo_pago: 'nequi', telefono_nequi: '3105551234' })).body.envio;
    expect((await c.pagos.procesarPendientes.execute()) >= 1).toBe(true);
    expect((await request(app).get(`/api/envios/${r2.id_envio}/pago`).set(auth(cliente.token))).body.estado).toBe('rechazado');
    nequi.estado = 'pendiente';
    const reintento = await request(app).post(`/api/envios/${r2.id_envio}/pago/reintentar`).set(auth(cliente.token)).send({ telefono: '3209998877' });
    expect(reintento.body.pago).toMatchObject({ estado: 'pendiente', telefono: '*** *** 8877' });
    expect((await request(app).post(`/api/envios/${r2.id_envio}/pago/reintentar`).set(auth(cliente.token)).send({ telefono: '1' })).status).toBe(400);
    const efectivo = await request(app).post(`/api/envios/${r2.id_envio}/pago/efectivo`).set(auth(cliente.token));
    expect(efectivo.body.pago).toMatchObject({ metodo: 'efectivo', estado: 'por_cobrar' });
    expect(await tablero(conductor.token)).toContain(r2.id_envio);
    expect((await request(app).get(`/api/envios/${r2.id_envio}`).set(auth(cliente.token))).body.envio.metodo_pago).toBe('efectivo');
    expect((await request(app).post(`/api/envios/${r2.id_envio}/pago/efectivo`).set(auth(cliente.token))).body.pago.metodo).toBe('efectivo');

    // Nequi no disponible al crear: el pago queda rechazado con el motivo
    nequi.fallarCobro = true;
    const r3 = (await crear(cliente.token, { metodo_pago: 'nequi', telefono_nequi: '3105551234' })).body.envio;
    expect(r3.pago).toMatchObject({ estado: 'rechazado', mensaje: 'Nequi no disponible' });
  });

  conBd('cancelar un envío pagado con Nequi devuelve el dinero (o deja el reembolso pendiente para el administrador)', async () => {
    const cliente = await sesion(app, 'reembolso.cli@t.co', 2);
    const admin = await sesionAdmin(app);
    nequi.estado = 'aprobado';
    const a = (await crear(cliente.token, { metodo_pago: 'nequi', telefono_nequi: '3105551234' })).body.envio;
    await request(app).get(`/api/envios/${a.id_envio}/pago`).set(auth(cliente.token));
    const cancel = await request(app).post(`/api/envios/${a.id_envio}/cancelar`).set(auth(cliente.token)).send({});
    expect(cancel.body.envio.pago).toMatchObject({ estado: 'reembolsado' });

    const b = (await crear(cliente.token, { metodo_pago: 'nequi', telefono_nequi: '3105551234' })).body.envio;
    await request(app).get(`/api/envios/${b.id_envio}/pago`).set(auth(cliente.token));
    nequi.fallarReembolso = true;
    expect((await request(app).post(`/api/envios/${b.id_envio}/cancelar`).set(auth(cliente.token)).send({})).body.envio.pago.estado).toBe('reembolso_pendiente');
    const pendientes = await request(app).get('/api/admin/pagos?estado=reembolso_pendiente').set(auth(admin.token));
    expect(pendientes.body.items.map((p: { id_envio: number }) => p.id_envio)).toContain(b.id_envio);
    nequi.fallarReembolso = false;
    expect((await request(app).post(`/api/admin/pagos/${b.id_envio}/reembolso`).set(auth(admin.token))).body.pago.estado).toBe('reembolsado');
    expect((await request(app).post(`/api/admin/pagos/${b.id_envio}/reembolso`).set(auth(admin.token))).status).toBe(400);
    expect((await request(app).get('/api/admin/pagos?metodo=nequi&pagina=1').set(auth(admin.token))).body.total).toBeGreaterThan(2);

    // Efectivo cancelado: anulado
    const e = (await crear(cliente.token)).body.envio;
    expect((await request(app).post(`/api/envios/${e.id_envio}/cancelar`).set(auth(cliente.token)).send({})).body.envio.pago.estado).toBe('anulado');
  });

  conBd('liquidación semanal: Nequi suma a favor del conductor y el efectivo resta la comisión', async () => {
    const cliente = await sesion(app, 'liq.cli@t.co', 2);
    const conductor = await conductorListo('liq.con@t.co', 'LIQ12A');
    const admin = await sesionAdmin(app);
    nequi.estado = 'aprobado';
    const n = (await crear(cliente.token, { metodo_pago: 'nequi', telefono_nequi: '3105551234' })).body.envio;
    await request(app).get(`/api/envios/${n.id_envio}/pago`).set(auth(cliente.token));
    await entregar(conductor.token, n);
    const e = (await crear(cliente.token)).body.envio;
    expect((await entregar(conductor.token, e, { efectivo_recibido: true })).status).toBe(200);

    const ganancia = (t: number) => Math.round(t * 0.8);
    const billetera = (await request(app).get('/api/conductores/me/billetera').set(auth(conductor.token))).body;
    expect(billetera.pendiente).toEqual({
      servicios: 2,
      ganancia_nequi: ganancia(n.tarifa),
      cobrado_efectivo: e.tarifa,
      comision_efectivo: e.tarifa - ganancia(e.tarifa),
      saldo: ganancia(n.tarifa) - (e.tarifa - ganancia(e.tarifa)),
    });
    expect(billetera.movimientos).toHaveLength(2);

    expect((await request(app).post('/api/admin/liquidaciones/generar').set(auth(admin.token)).send({ hasta: '2999-01-01' })).status).toBe(400);
    expect((await request(app).post('/api/admin/liquidaciones/generar').set(auth(admin.token)).send({ hasta: 'ayer' })).status).toBe(400);
    const hoy = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
    const gen = await request(app).post('/api/admin/liquidaciones/generar').set(auth(admin.token)).send({ hasta: hoy });
    const mia = gen.body.liquidaciones.find((l: { conductor_nombre: string }) => l.conductor_nombre === 'Camilo Rojas');
    expect(mia).toBeUndefined(); // generar no trae el nombre, se busca por saldo
    const lista = (await request(app).get('/api/admin/liquidaciones?estado=pendiente').set(auth(admin.token))).body;
    const liq = lista.items.find((l: { saldo: number }) => l.saldo === billetera.pendiente.saldo);
    expect(liq).toMatchObject({ servicios: 2, hasta: hoy, estado: 'pendiente', conductor_nombre: 'Camilo Rojas' });
    expect((await request(app).get('/api/conductores/me/billetera').set(auth(conductor.token))).body.pendiente.servicios).toBe(0);
    // Idempotente
    expect((await request(app).post('/api/admin/liquidaciones/generar').set(auth(admin.token)).send({ hasta: hoy })).body.liquidaciones).toEqual([]);
    expect((await request(app).post(`/api/admin/liquidaciones/${liq.id_liquidacion}/pagar`).set(auth(admin.token)).send({})).status).toBe(400);
    const pagada = await request(app).post(`/api/admin/liquidaciones/${liq.id_liquidacion}/pagar`).set(auth(admin.token)).send({ referencia: 'Nequi M123456' });
    expect(pagada.body.liquidacion).toMatchObject({ estado: 'pagada', referencia: 'Nequi M123456' });
    expect((await request(app).post(`/api/admin/liquidaciones/${liq.id_liquidacion}/pagar`).set(auth(admin.token)).send({ referencia: 'otra' })).status).toBe(400);
    expect((await request(app).post('/api/admin/liquidaciones/999999/pagar').set(auth(admin.token)).send({ referencia: 'otra' })).status).toBe(404);
    const avisos = (await request(app).get('/api/notificaciones').set(auth(conductor.token))).body.items.filter((a: { tipo: string }) => a.tipo === 'liquidacion');
    expect(avisos).toHaveLength(2);
    expect((await request(app).get('/api/conductores/me/billetera').set(auth(conductor.token))).body.liquidaciones[0].estado).toBe('pagada');
    // El trabajo automático cierra la semana anterior sin errores
    await expect(c.pagos.generarLiquidaciones.execute(null)).resolves.toEqual(expect.any(Array));
  });
});

describe('Notificaciones al instante', () => {
  conBd('push: suscripción web y móvil, envío al notificar y limpieza de suscripciones vencidas', async () => {
    const s = await sesion(app, 'push.cli@t.co', 2);
    expect((await request(app).get('/api/push/clave-publica')).body).toEqual({ clave: null });
    expect((await request(app).post('/api/push/suscripciones').set(auth(s.token)).send({ plataforma: 'web', endpoint: 'http://x' })).status).toBe(400);
    expect((await request(app).post('/api/push/suscripciones').set(auth(s.token)).send({ plataforma: 'tv' })).status).toBe(400);
    expect((await request(app).post('/api/push/suscripciones').set(auth(s.token)).send({ plataforma: 'android', token: 'x' })).status).toBe(400);
    const web = { plataforma: 'web', endpoint: 'https://push.ejemplo.com/abc123', keys: { p256dh: 'clave', auth: 'secreto' } };
    expect((await request(app).post('/api/push/suscripciones').set(auth(s.token)).send(web)).status).toBe(201);
    expect((await request(app).post('/api/push/suscripciones').set(auth(s.token)).send({ plataforma: 'android', token: 'fcm-token-de-prueba-1234567890' })).status).toBe(201);
    await request(app).post('/api/push/suscripciones').set(auth(s.token)).send({ ...web, endpoint: 'https://push.ejemplo.com/vencido' });
    pushEnviados.length = 0;
    await crear(s.token);
    await request(app).post('/api/envios/1/cancelar').set(auth(s.token)).send({});
    // Una notificación cualquiera (cancelación por admin) dispara el push a los tres dispositivos
    const admin = await sesionAdmin(app);
    const e = (await crear(s.token)).body.envio;
    await request(app).post(`/api/envios/${e.id_envio}/cancelar`).set(auth(admin.token)).send({ motivo: 'Prueba push' });
    await new Promise((r) => setTimeout(r, 50));
    expect(pushEnviados.map((p) => p.endpoint).sort()).toEqual(['fcm-token-de-prueba-1234567890', 'https://push.ejemplo.com/abc123', 'https://push.ejemplo.com/vencido']);
    pushEnviados.length = 0;
    await request(app).post(`/api/envios/${(await crear(s.token)).body.envio.id_envio}/cancelar`).set(auth(admin.token)).send({ motivo: 'Otra' });
    await new Promise((r) => setTimeout(r, 50));
    expect(pushEnviados.map((p) => p.endpoint)).not.toContain('https://push.ejemplo.com/vencido');
    expect((await request(app).delete('/api/push/suscripciones').set(auth(s.token)).send({})).status).toBe(400);
    expect((await request(app).delete('/api/push/suscripciones').set(auth(s.token)).send({ endpoint: web.endpoint })).status).toBe(204);
  });

  conBd('SSE: el ticket abre el canal una sola vez y los avisos llegan al instante', async () => {
    const s = await sesion(app, 'sse.cli@t.co', 2);
    const admin = await sesionAdmin(app);
    const servidor = app.listen(0);
    const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    try {
      expect((await request(app).get('/api/eventos?ticket=falso')).status).toBe(401);
      const ticket = (await request(app).post('/api/eventos/ticket').set(auth(s.token))).body.ticket as string;
      const ctrl = new AbortController();
      const r = await fetch(`${base}/api/eventos?ticket=${ticket}`, { signal: ctrl.signal });
      expect(r.headers.get('content-type')).toMatch(/text\/event-stream/);
      const lector = r.body!.getReader();
      let texto = '';
      const leerHasta = async (patron: RegExp) => {
        while (!patron.test(texto)) texto += new TextDecoder().decode((await lector.read()).value);
      };
      await leerHasta(/event: conectado/);
      expect((await fetch(`${base}/api/eventos?ticket=${ticket}`)).status).toBe(401);
      const e = (await crear(s.token)).body.envio;
      await request(app).post(`/api/envios/${e.id_envio}/cancelar`).set(auth(admin.token)).send({ motivo: 'Evento SSE' });
      await leerHasta(/event: notificacion\ndata: .*Evento SSE/);
      ctrl.abort();
    } finally {
      servidor.close();
    }
  });
});

describe('Seguimiento público, edición y envíos avanzados', () => {
  conBd('enlace para quien recibe: estado y conductor sin datos sensibles; el cliente edita mientras está pendiente', async () => {
    const cliente = await sesion(app, 'link.cli@t.co', 2, 'Marta Gómez');
    const otro = await sesion(app, 'link.otro@t.co', 2);
    const conductor = await conductorListo('link.con@t.co', 'LNK12A');
    const envio = (await crear(cliente.token, { destinatario_nombre: 'Pedro Pérez', destinatario_telefono: '311 222 3344' })).body.envio;
    expect(envio).toMatchObject({ destinatario_nombre: 'Pedro Pérez', destinatario_telefono: '3112223344', token_seguimiento: expect.stringMatching(/^[\w-]{32}$/) });
    const pub = await request(app).get(`/api/publico/seguimiento/${envio.token_seguimiento}`);
    expect(pub.body).toMatchObject({ codigo: envio.id_envio, estado: 'Pendiente', destinatario: 'Pedro', conductor: null });
    expect(JSON.stringify(pub.body)).not.toMatch(/pin|tarifa|3112223344|Marta/);
    expect((await request(app).get('/api/publico/seguimiento/no-existe')).status).toBe(404);
    expect((await request(app).get(`/api/publico/seguimiento/${'a'.repeat(32)}`)).status).toBe(404);

    // Editar
    expect((await request(app).patch(`/api/envios/${envio.id_envio}`).set(auth(cliente.token)).send({})).status).toBe(400);
    expect((await request(app).patch(`/api/envios/${envio.id_envio}`).set(auth(otro.token)).send({ notas: 'x' })).status).toBe(403);
    const ed = await request(app).patch(`/api/envios/${envio.id_envio}`).set(auth(cliente.token)).send({ notas: 'Casa azul', tipo_carga: 'Paquete', destinatario_nombre: '', destinatario_telefono: '3001112233' });
    expect(ed.body.envio).toMatchObject({ notas: 'Casa azul', tipo_carga: 'Paquete', destinatario_nombre: null, destinatario_telefono: '3001112233' });

    await request(app).post('/api/envios/aceptar').set(auth(conductor.token)).send({ id_envio: envio.id_envio });
    expect((await request(app).patch(`/api/envios/${envio.id_envio}`).set(auth(cliente.token)).send({ notas: 'y' })).status).toBe(400);
    const pub2 = (await request(app).get(`/api/publico/seguimiento/${envio.token_seguimiento}`)).body;
    expect(pub2.conductor).toEqual({ nombre: 'Camilo', vehiculo: 'Camioneta', placa: 'LNK12A' });
    expect(pub2.historial.map((h: { estado: string }) => h.estado)).toEqual(['Asignado', 'Pendiente']);
    // El conductor asignado ve a quién entregar
    expect((await request(app).get(`/api/envios/${envio.id_envio}`).set(auth(conductor.token))).body.envio.destinatario_telefono).toBe('3001112233');
  });

  conBd('envíos programados: validan la fecha y aparecen en el tablero una hora antes', async () => {
    const cliente = await sesion(app, 'prog.cli@t.co', 2);
    const conductor = await conductorListo('prog.con@t.co', 'PRG12A');
    const en = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
    expect((await crear(cliente.token, { fecha_programada: en(10) })).body.error).toMatch(/al menos 30 minutos/);
    expect((await crear(cliente.token, { fecha_programada: en(8 * 24 * 60) })).body.error).toMatch(/hasta con 7 días/);
    expect((await crear(cliente.token, { fecha_programada: 'mañana' })).status).toBe(400);
    const pronto = (await crear(cliente.token, { fecha_programada: en(45) })).body.envio;
    const tarde = (await crear(cliente.token, { fecha_programada: en(180) })).body.envio;
    expect(tarde.fecha_programada).toBe(new Date(tarde.fecha_programada).toISOString());
    const ids = await tablero(conductor.token);
    expect(ids).toContain(pronto.id_envio);
    expect(ids).not.toContain(tarde.id_envio);
    // Dos horas y media después, el trabajo programado lo anuncia
    const futuro = crearContenedorPrueba(() => new Date(Date.now() + 150 * 60_000));
    expect(await futuro.envios.anunciarProgramados.execute()).toBeGreaterThanOrEqual(1);
    expect(await futuro.envios.anunciarProgramados.execute()).toBe(0);
    const avisos = (await request(app).get('/api/notificaciones').set(auth(conductor.token))).body.items;
    expect(avisos.some((a: { id_envio: number; mensaje: string }) => a.id_envio === tarde.id_envio && /Programado para/.test(a.mensaje))).toBe(true);
  });

  conBd('paradas e ida y vuelta: precio por tramos y el conductor completa cada parada antes de finalizar', async () => {
    const cliente = await sesion(app, 'paradas.cli@t.co', 2);
    const conductor = await conductorListo('paradas.con@t.co', 'PAR12A');
    expect((await crear(cliente.token, { paradas: [{ direccion: 'Sin mapa' }] })).body.error).toBe('Ubica en el mapa la parada 1');
    expect((await crear(cliente.token, { paradas: [PARADA, PARADA, PARADA, PARADA] })).body.error).toBe('Puedes agregar máximo 3 paradas');
    expect((await crear(cliente.token, { paradas: 'x' })).status).toBe(400);
    expect((await crear(cliente.token, { paradas: [{ ...PARADA, coords: { lat: 4.711, lon: -74.07 } }] })).body.error).toBe('La parada 1 está fuera de nuestra zona de cobertura');
    const cot = await request(app).post('/api/cotizar/cotizar').set(auth(cliente.token)).send({ ...BASE, paradas: [PARADA], ida_y_vuelta: true });
    // origen → parada → destino → origen = 3 tramos de 34,5 km (distancia fija de las pruebas)
    expect(cot.body).toMatchObject({ distancia_km: 103.5, desglose: { paradas: 1, recargo_paradas: 1500, ida_y_vuelta: true } });
    const envio = (await crear(cliente.token, { paradas: [PARADA], ida_y_vuelta: true })).body.envio;
    expect(envio.paradas).toEqual([{ orden: 1, direccion: PARADA.direccion, coords: PARADA.coords, notas: null, completada_en: null }]);
    expect(envio.ida_y_vuelta).toBe(true);
    expect((await request(app).get('/api/conductores/envios/disponibles').set(auth(conductor.token))).body.envios.find((e: { id_envio: number }) => e.id_envio === envio.id_envio).paradas).toHaveLength(1);

    await request(app).post('/api/envios/aceptar').set(auth(conductor.token)).send({ id_envio: envio.id_envio });
    const detalle = (await request(app).get(`/api/envios/${envio.id_envio}`).set(auth(conductor.token))).body.envio;
    const idParada = detalle.paradas[0].id_parada;
    expect((await request(app).post(`/api/envios/${envio.id_envio}/paradas/${idParada}/completar`).set(auth(conductor.token))).status).toBe(400);
    await request(app).post(`/api/envios/${envio.id_envio}/recogida`).set(auth(conductor.token)).attach('archivo', JPG, { filename: 'r.jpg', contentType: 'image/jpeg' });
    const evid = await request(app).post(`/api/envios/${envio.id_envio}/evidencia`).set(auth(conductor.token)).attach('archivo', JPG, { filename: 'e.jpg', contentType: 'image/jpeg' });
    const validar = () =>
      request(app)
        .post(`/api/envios/${envio.id_envio}/validar-entrega`)
        .set(auth(conductor.token))
        .send({ url_foto: evid.body.url_foto, pin_seguridad: envio.pin_seguridad, efectivo_recibido: true });
    expect((await validar()).body.error).toBe('Marca como hechas las paradas pendientes (1) antes de finalizar');
    expect((await request(app).post(`/api/envios/${envio.id_envio}/paradas/9999/completar`).set(auth(conductor.token))).status).toBe(404);
    const hecha = await request(app).post(`/api/envios/${envio.id_envio}/paradas/${idParada}/completar`).set(auth(conductor.token));
    expect(hecha.body.paradas[0].completada_en).toEqual(expect.any(String));
    expect((await validar()).body.error).toMatch(/marca la llegada al destino/);
    const llegada = await request(app).post(`/api/envios/${envio.id_envio}/llegada-destino`).set(auth(conductor.token));
    expect(llegada.body.envio.destino_visitado_en).toEqual(expect.any(String));
    // De regreso, el mapa apunta al origen
    expect((await request(app).get(`/api/envios/${envio.id_envio}/seguimiento`).set(auth(cliente.token))).status).toBe(200);
    expect((await validar()).body.envio.estado).toBe('Entregado');
    const simple = (await crear(cliente.token)).body.envio;
    await request(app).post('/api/envios/aceptar').set(auth(conductor.token)).send({ id_envio: simple.id_envio });
    await request(app).post(`/api/envios/${simple.id_envio}/recogida`).set(auth(conductor.token)).attach('archivo', JPG, { filename: 'r.jpg', contentType: 'image/jpeg' });
    expect((await request(app).post(`/api/envios/${simple.id_envio}/llegada-destino`).set(auth(conductor.token))).body.error).toBe('Este envío no es de ida y vuelta');
  });

  conBd('chat entre cliente y conductor: solo los participantes, mientras el servicio está activo', async () => {
    const cliente = await sesion(app, 'chat.cli@t.co', 2, 'Sofía Ruiz');
    const otro = await sesion(app, 'chat.otro@t.co', 2);
    const conductor = await conductorListo('chat.con@t.co', 'CHT12A');
    const admin = await sesionAdmin(app);
    const envio = (await crear(cliente.token)).body.envio;
    const url = `/api/envios/${envio.id_envio}/mensajes`;
    expect((await request(app).get(url).set(auth(cliente.token))).body).toEqual({ abierto: false, mensajes: [] });
    expect((await request(app).post(url).set(auth(cliente.token)).send({ texto: 'Hola' })).status).toBe(400);
    await request(app).post('/api/envios/aceptar').set(auth(conductor.token)).send({ id_envio: envio.id_envio });
    expect((await request(app).post(url).set(auth(cliente.token)).send({ texto: '   ' })).body.error).toBe('Escribe un mensaje');
    expect((await request(app).post(url).set(auth(cliente.token)).send({ texto: 'x'.repeat(501) })).status).toBe(400);
    const m = await request(app).post(url).set(auth(cliente.token)).send({ texto: '  La portería es la de la izquierda \u0007' });
    expect(m.status).toBe(201);
    expect(m.body).toMatchObject({ texto: 'La portería es la de la izquierda', mio: true, autor: 'Sofía' });
    expect((await request(app).get(`/api/envios/${envio.id_envio}`).set(auth(conductor.token))).body.envio.chat_no_leidos).toBe(1);
    const vista = (await request(app).get(url).set(auth(conductor.token))).body;
    expect(vista.abierto).toBe(true);
    expect(vista.mensajes[0]).toMatchObject({ mio: false, autor: 'Sofía' });
    expect((await request(app).get(`/api/envios/${envio.id_envio}`).set(auth(conductor.token))).body.envio.chat_no_leidos).toBe(0);
    await request(app).post(url).set(auth(conductor.token)).send({ texto: 'Llego en 5 minutos' });
    expect((await request(app).get(url).set(auth(cliente.token))).body.mensajes.map((x: { mio: boolean }) => x.mio)).toEqual([true, false]);
    expect((await request(app).get(url).set(auth(admin.token))).body.abierto).toBe(false);
    expect((await request(app).post(url).set(auth(admin.token)).send({ texto: 'hola' })).status).toBe(403);
    expect((await request(app).get(url).set(auth(otro.token))).status).toBe(403);
  });
});

describe('Eliminar: zonas, mensajes y notificaciones', () => {
  conBd('una zona sin envíos se borra; con envíos se archiva y desaparece de las listas', async () => {
    const admin = await sesionAdmin(app);
    const nueva = (await request(app).post('/api/admin/zonas').set(auth(admin.token)).send({ nombre_zona: 'Chinauta', recargo: 2000, centro: { lat: 4.27, lon: -74.44 }, radio_km: 3 })).body.zona;
    const borrar = await request(app).delete(`/api/admin/zonas/${nueva.id_zona}`).set(auth(admin.token));
    expect(borrar.body).toMatchObject({ resultado: 'borrada', message: 'Zona eliminada' });
    expect((await request(app).delete(`/api/admin/zonas/${nueva.id_zona}`).set(auth(admin.token))).status).toBe(404);
    // Silvania (id 4) tiene envíos de las pruebas anteriores
    const arch = await request(app).delete('/api/admin/zonas/4').set(auth(admin.token));
    expect(arch.body.resultado).toBe('archivada');
    const zonas = (await request(app).get('/api/admin/zonas').set(auth(admin.token))).body;
    expect(zonas.map((z: { id_zona: number }) => z.id_zona)).not.toContain(4);
    // El nombre queda libre para crear otra zona igual
    expect((await request(app).post('/api/admin/zonas').set(auth(admin.token)).send({ nombre_zona: 'Silvania', recargo: 2000, centro: SILVANIA, radio_km: 3 })).status).toBe(201);
    const cli = await sesion(app, 'zonas.cli@t.co', 2);
    expect((await request(app).delete('/api/admin/zonas/1').set(auth(cli.token))).status).toBe(403);
  });

  conBd('mensajes de contacto y notificaciones se pueden borrar', async () => {
    const admin = await sesionAdmin(app);
    const m = (await request(app).post('/api/contacto').send({ nombre: 'Tienda Uno', correo: 't@x.co', mensaje: 'Queremos un plan para empresas' })).body;
    expect((await request(app).delete(`/api/admin/contactos/${m.id}`).set(auth(admin.token))).status).toBe(204);
    expect((await request(app).delete(`/api/admin/contactos/${m.id}`).set(auth(admin.token))).status).toBe(404);

    const s = await sesion(app, 'notif.borrar@t.co', 2);
    for (const motivo of ['Uno', 'Dos']) {
      const e = (await crear(s.token)).body.envio;
      await request(app).post(`/api/envios/${e.id_envio}/cancelar`).set(auth(admin.token)).send({ motivo });
    }
    const items = (await request(app).get('/api/notificaciones').set(auth(s.token))).body.items;
    expect(items).toHaveLength(2);
    expect((await request(app).delete(`/api/notificaciones/${items[0].id}`).set(auth(s.token))).status).toBe(204);
    expect((await request(app).delete(`/api/notificaciones/${items[0].id}`).set(auth(s.token))).status).toBe(404);
    await request(app).post('/api/notificaciones/leer-todas').set(auth(s.token));
    expect((await request(app).delete('/api/notificaciones').set(auth(s.token))).body).toEqual({ borradas: 1 });
    expect((await request(app).get('/api/notificaciones').set(auth(s.token))).body.items).toEqual([]);
  });
});
