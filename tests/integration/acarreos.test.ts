import request from 'supertest';
import { Express } from 'express';
import { pool } from '../../src/config/database';
import { FUSA, SILVANIA, aprobarConductor, crearAppPrueba, hayBaseDeDatos, reiniciarBase, sesion, sesionAdmin } from '../helpers/app';

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
    if (!disponible) return expect(disponible).toBe(false);
    await fn();
  });

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const RUTA = { origen: 'Parque principal', destino: 'Silvania', origen_coords: FUSA, destino_coords: SILVANIA };
const TRASTEO = { objetos: 'Nevera, cama doble y 10 cajas', pisos_origen: 3, ayudantes: 1, bultos: 12 };

async function conductorConFurgoneta(correo: string, placa: string) {
  const s = await sesion(app, correo, 3, 'Camilo Rojas');
  const admin = await sesionAdmin(app);
  const me = (await request(app).get('/api/conductores/me').set(auth(s.token))).body;
  await request(app).post('/api/vehicles/register').set(auth(s.token)).send({ placa, categoria: 'Furgoneta' });
  await aprobarConductor(app, s.token, admin.token, me.id_conductor);
  return s;
}

const foto = (r: request.Test) => r.attach('archivo', JPG, { filename: 'r.jpg', contentType: 'image/jpeg' });

describe('Acarreos: tipos de servicio y entrega sin confusiones', () => {
  conBd('cotiza un trasteo con ayudantes y escaleras y solo ofrece vehículos capaces', async () => {
    const cliente = await sesion(app, 'tras.cli@t.co', 2);
    const cot = await request(app).post('/api/cotizar/cotizar').set(auth(cliente.token)).send({ ...RUTA, tipo_servicio: 'trasteo', detalle_servicio: TRASTEO });
    expect(cot.status).toBe(200);
    expect(cot.body).toMatchObject({ tipo_servicio: 'trasteo', vehiculo_minimo: 'Furgoneta', categoria: 'Furgoneta' });
    expect(cot.body.opciones.map((o: { categoria: string }) => o.categoria)).toEqual(['Furgoneta']);
    expect(cot.body.desglose.extras).toEqual([
      { concepto: '1 ayudante', valor: 25000 },
      { concepto: 'Escaleras (2 pisos)', valor: 8000 },
    ]);
    const moto = await request(app).post('/api/cotizar/cotizar').set(auth(cliente.token)).send({ ...RUTA, categoria: 'Moto Express', tipo_servicio: 'trasteo', detalle_servicio: TRASTEO });
    expect(moto.body.error).toBe('Este pedido de trasteo necesita mínimo Furgoneta');
    const pesado = await request(app)
      .post('/api/cotizar/cotizar')
      .set(auth(cliente.token))
      .send({ ...RUTA, categoria: 'Moto Express', tipo_servicio: 'insumos', detalle_servicio: { insumo: 'Abono', peso_kg: 600, acceso_destapado: true } });
    expect(pesado.body.error).toBe('Este pedido de insumos del campo de 600 kg necesita mínimo Furgoneta');
    const insumos = await request(app)
      .post('/api/cotizar/cotizar')
      .set(auth(cliente.token))
      .send({ ...RUTA, tipo_servicio: 'insumos', detalle_servicio: { insumo: 'Abono', peso_kg: 600, acceso_destapado: true } });
    expect(insumos.body).toMatchObject({ categoria: 'Furgoneta', desglose: { recargo_acceso: expect.any(Number) } });
    expect(insumos.body.desglose.recargo_acceso).toBeGreaterThan(0);
    expect((await request(app).post('/api/cotizar/cotizar').set(auth(cliente.token)).send({ ...RUTA, tipo_servicio: 'mercado' })).body.error).toBe(
      'Completa el campo "lista del mercado"',
    );
  });

  conBd('trasteo: llegada a recoger, código, bultos contados y llegada al destino avisan al cliente', async () => {
    const cliente = await sesion(app, 'paso.cli@t.co', 2);
    const conductor = await conductorConFurgoneta('paso.con@t.co', 'TRA123');
    const crear = await request(app)
      .post('/api/envios/crear')
      .set(auth(cliente.token))
      .send({ ...RUTA, tipo_servicio: 'trasteo', detalle_servicio: TRASTEO, destinatario_nombre: 'Ana Ruiz' });
    expect(crear.status).toBe(201);
    const envio = crear.body.envio;
    expect(envio).toMatchObject({ tipo_servicio: 'trasteo', tipo_carga: 'Acarreo', etapa: 'buscando_conductor', pide_codigo_recogida: true });
    expect(envio.codigo_recogida).toMatch(/^\d{4}$/);
    expect(envio.detalle_servicio).toMatchObject({ ayudantes: 1, bultos: 12 });

    // El conductor ve el detalle, pero no el código
    const disponibles = (await request(app).get('/api/conductores/envios/disponibles').set(auth(conductor.token))).body.envios;
    const visto = disponibles.find((e: { id_envio: number }) => e.id_envio === envio.id_envio);
    expect(visto).toMatchObject({ tipo_servicio: 'trasteo', pide_codigo_recogida: true, detalle_servicio: { objetos: TRASTEO.objetos } });
    expect(visto.codigo_recogida).toBeUndefined();

    await request(app).post('/api/envios/aceptar').set(auth(conductor.token)).send({ id_envio: envio.id_envio });
    const llegue = await request(app).post(`/api/envios/${envio.id_envio}/llegada-recogida`).set(auth(conductor.token));
    expect(llegue.body.envio).toMatchObject({ etapa: 'en_recogida', llegada_recogida_en: expect.any(String) });
    const avisos = (await request(app).get('/api/notificaciones').set(auth(cliente.token))).body.items;
    expect(avisos[0]).toMatchObject({ tipo: 'conductor_en_recogida', titulo: 'Tu conductor llegó a recoger' });
    expect(avisos[0].mensaje).toMatch(/código de recogida/);
    // Repetir no duplica el aviso
    await request(app).post(`/api/envios/${envio.id_envio}/llegada-recogida`).set(auth(conductor.token));
    expect((await request(app).get('/api/notificaciones').set(auth(cliente.token))).body.items.filter((n: { tipo: string }) => n.tipo === 'conductor_en_recogida')).toHaveLength(1);

    const recoger = (campos: Record<string, string>) => {
      const r = request(app).post(`/api/envios/${envio.id_envio}/recogida`).set(auth(conductor.token));
      for (const [k, v] of Object.entries(campos)) r.field(k, v);
      return foto(r);
    };
    expect((await recoger({})).body.error).toBe('Pide el código de recogida a quien te entrega la carga');
    expect((await recoger({ codigo_recogida: '0000' })).body.error).toBe('El código de recogida no coincide');
    expect((await recoger({ codigo_recogida: envio.codigo_recogida })).body.error).toBe('Cuenta los bultos: el cliente declaró 12');
    const ok = await recoger({ codigo_recogida: envio.codigo_recogida, bultos: '11' });
    expect(ok.body.envio).toMatchObject({ estado: 'En Ruta', etapa: 'en_camino', bultos_recogidos: 11, valor_compra: null });
    const tras = (await request(app).get('/api/notificaciones').set(auth(cliente.token))).body.items[0];
    expect(tras).toMatchObject({ tipo: 'paquete_recogido', titulo: 'Revisa los bultos de tu pedido' });
    expect(tras.mensaje).toMatch(/^Contó 11 bultos y declaraste 12\./);

    const destino = await request(app).post(`/api/envios/${envio.id_envio}/llegada-destino`).set(auth(conductor.token));
    expect(destino.body.envio.etapa).toBe('en_destino');
    expect((await request(app).get('/api/notificaciones').set(auth(cliente.token))).body.items[0]).toMatchObject({ tipo: 'conductor_en_destino' });

    // Quien recibe ve el mismo paso en el enlace público
    const publico = await request(app).get(`/api/publico/seguimiento/${envio.token_seguimiento}`);
    expect(publico.body).toMatchObject({ etapa: 'en_destino', tipo_servicio: 'trasteo' });
    expect(publico.body.codigo_recogida).toBeUndefined();

    const evid = await foto(request(app).post(`/api/envios/${envio.id_envio}/evidencia`).set(auth(conductor.token)));
    const entrega = await request(app)
      .post(`/api/envios/${envio.id_envio}/validar-entrega`)
      .set(auth(conductor.token))
      .send({ url_foto: evid.body.url_foto, pin_seguridad: envio.pin_seguridad, efectivo_recibido: true });
    expect(entrega.body.envio.estado).toBe('Entregado');
  });

  conBd('mercado: sin código de recogida, el conductor registra la compra y la cobra al entregar', async () => {
    const cliente = await sesion(app, 'merc.cli@t.co', 2);
    const conductor = await conductorConFurgoneta('merc.con@t.co', 'MER456');
    const envio = (
      await request(app)
        .post('/api/envios/crear')
        .set(auth(cliente.token))
        .send({ ...RUTA, tipo_servicio: 'mercado', detalle_servicio: { lista: 'Arroz, aceite, huevos', presupuesto: 60000 }, metodo_pago: 'efectivo' })
    ).body.envio;
    expect(envio).toMatchObject({ tipo_carga: 'Mercado', pide_codigo_recogida: false, codigo_recogida: null });
    await request(app).post('/api/envios/aceptar').set(auth(conductor.token)).send({ id_envio: envio.id_envio });
    // Sin pasar por "llegué", la recogida marca también la llegada
    const ok = await foto(request(app).post(`/api/envios/${envio.id_envio}/recogida`).set(auth(conductor.token)).field('valor_compra', '52300'));
    expect(ok.body.envio).toMatchObject({ valor_compra: 52300, llegada_recogida_en: expect.any(String) });
    expect((await request(app).get('/api/notificaciones').set(auth(cliente.token))).body.items[0].mensaje).toMatch(/La compra costó \$ 52\.300/);

    const evid = await foto(request(app).post(`/api/envios/${envio.id_envio}/evidencia`).set(auth(conductor.token)));
    const validar = (extra: object) =>
      request(app)
        .post(`/api/envios/${envio.id_envio}/validar-entrega`)
        .set(auth(conductor.token))
        .send({ url_foto: evid.body.url_foto, pin_seguridad: envio.pin_seguridad, ...extra });
    const total = (envio.tarifa as number) + 52300;
    expect((await validar({})).body.error).toBe(`Confirma que recibiste $ ${total.toLocaleString('es-CO')} en efectivo`);
    const entregado = await validar({ efectivo_recibido: true });
    expect(entregado.status).toBe(200);
    const detalle = (await request(app).get(`/api/envios/${envio.id_envio}`).set(auth(cliente.token))).body.envio;
    expect(detalle).toMatchObject({ etapa: 'entregado', llegada_destino_en: expect.any(String), valor_compra: 52300 });
  });

  conBd('verificación: el administrador revisa cada documento y el conductor ve su avance', async () => {
    const conductor = await sesion(app, 'ver.con@t.co', 3, 'Laura Peña');
    const admin = await sesionAdmin(app);
    const me = (await request(app).get('/api/conductores/me').set(auth(conductor.token))).body;
    const sinFecha = await foto(request(app).post('/api/documentos/upload').set(auth(conductor.token)).field('tipo_documento', 'SOAT'));
    expect(sinFecha.body.error).toBe('Indica la fecha de vencimiento de: SOAT (debe estar vigente)');
    await foto(request(app).post('/api/documentos/upload').set(auth(conductor.token)).field('tipo_documento', 'Selfie'));
    const lista = (await request(app).get('/api/conductores/pendientes').set(auth(admin.token))).body;
    const yo = lista.find((c: { id_conductor: number }) => c.id_conductor === me.id_conductor);
    const selfie = yo.documentos.find((d: { tipo_documento: string }) => d.tipo_documento === 'Selfie');
    expect(yo.requisitos.items.find((i: { tipo: string }) => i.tipo === 'Antecedentes').verificar.url).toMatch(/^https:\/\/antecedentes\.policia\.gov\.co/);

    const rechazo = await request(app).patch(`/api/admin/documentos/${selfie.id}`).set(auth(admin.token)).send({ aprobado: false, motivo: 'No se ve la cédula' });
    expect(rechazo.body).toMatchObject({ message: 'Documento rechazado', documento: { estado: 'Rechazado', motivo_rechazo: 'No se ve la cédula' } });
    expect((await request(app).patch(`/api/admin/documentos/${selfie.id}`).set(auth(conductor.token)).send({ aprobado: true })).status).toBe(403);
    const perfil = (await request(app).get('/api/conductores/me').set(auth(conductor.token))).body;
    expect(perfil.requisitos.pendientes).toContain('Corrige: Selfie con la cédula (No se ve la cédula)');
    const aviso = (await request(app).get('/api/notificaciones').set(auth(conductor.token))).body.items[0];
    expect(aviso).toMatchObject({ tipo: 'documento_revisado', titulo: 'Corrige tu Selfie con la cédula' });
  });

  conBd('ruta para el mapa sin sesión', async () => {
    const r = await request(app).get('/api/geo/ruta').query({ puntos: `${FUSA.lat},${FUSA.lon};${SILVANIA.lat},${SILVANIA.lon}` });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ km: 34.5, exacta: true, puntos: [FUSA, SILVANIA] });
    expect((await request(app).get('/api/geo/ruta').query({ puntos: '1,1' })).status).toBe(400);
  });
});
