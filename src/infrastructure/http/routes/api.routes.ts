import { Request, Response, Router } from 'express';
import { ROLES } from '../../../domain/entities/actor.entity';
import { TIPOS_ARCHIVO_DOCUMENTO } from '../../../application/use-cases/drivers/driver.use-cases';
import { TIPOS_FOTO } from '../../../application/use-cases/shipments/driver-shipments.use-cases';
import { Contenedor } from '../../container';
import { actorDe, autenticar, autorizar } from '../middlewares/auth.middleware';
import { rateLimit } from '../middlewares/rate-limit.middleware';
import { subirArchivo } from '../middlewares/upload.middleware';

const { ADMIN, CLIENTE, CONDUCTOR } = ROLES;

function archivoDe(req: Request) {
  return req.file ? { buffer: req.file.buffer, mimetype: req.file.mimetype, originalname: req.file.originalname } : undefined;
}

/** Todas las rutas de /api. Las protegidas exigen JWT y el rol indicado. */
export function crearRutasApi(c: Contenedor): Router {
  const r = Router();
  const auth = autenticar(c.tokens);

  // --- Autenticación (públicas) ---
  r.post('/auth/register', rateLimit(20, 60_000), async (req: Request, res: Response) => {
    const user = await c.auth.registrar.execute(req.body ?? {});
    res.status(201).json({ message: 'Usuario registrado exitosamente', user });
  });
  r.post('/auth/login', rateLimit(10, 60_000), async (req: Request, res: Response) => {
    const result = await c.auth.login.execute(req.body ?? {});
    res.status(200).json({ message: 'Inicio de sesión exitoso', ...result });
  });
  r.post('/auth/olvide-password', rateLimit(5, 60_000), async (req: Request, res: Response) => {
    await c.auth.olvidePassword.execute(req.body ?? {});
    res.json({ message: 'Si el correo está registrado, te enviamos un enlace para restablecer la contraseña.' });
  });
  r.post('/auth/restablecer-password', rateLimit(10, 60_000), async (req: Request, res: Response) => {
    await c.auth.restablecerPassword.execute(req.body ?? {});
    res.json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  });
  r.post('/auth/verificar-correo', rateLimit(20, 60_000), async (req: Request, res: Response) => {
    res.json({ message: 'Correo verificado', ...(await c.auth.verificarCorreo.execute(req.body ?? {})) });
  });

  // --- Sitio público (sin sesión) ---
  r.get('/publico/estadisticas', async (_req: Request, res: Response) => {
    res.json(await c.publico.estadisticas.execute());
  });
  r.get('/publico/zonas', async (_req: Request, res: Response) => {
    res.json(await c.publico.zonas.execute());
  });
  r.get('/publico/tarifas', async (_req: Request, res: Response) => {
    res.json(await c.catalogo.tarifas.execute());
  });
  r.get('/publico/seguimiento/:token', rateLimit(60, 60_000), async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await c.envios.seguimientoPublico.execute(req.params.token));
  });
  r.post('/contacto', rateLimit(5, 60_000), async (req: Request, res: Response) => {
    const r2 = await c.publico.contacto.execute(req.body ?? {});
    res.status(201).json({ message: 'Recibimos tu mensaje. Te responderemos pronto.', ...r2 });
  });

  // --- Mi cuenta (cualquier rol) ---
  r.get('/usuarios/me', auth, async (req: Request, res: Response) => {
    res.json(await c.usuarios.perfil.execute(actorDe(req)));
  });
  r.patch('/usuarios/me', auth, async (req: Request, res: Response) => {
    res.json({ message: 'Perfil actualizado', usuario: await c.usuarios.actualizar.execute(actorDe(req), req.body ?? {}) });
  });
  r.post('/usuarios/me/password', auth, rateLimit(10, 60_000), async (req: Request, res: Response) => {
    await c.usuarios.cambiarPassword.execute(actorDe(req), req.body ?? {});
    res.json({ message: 'Contraseña actualizada' });
  });
  r.post('/usuarios/me/verificacion', auth, rateLimit(3, 60_000), async (req: Request, res: Response) => {
    const r2 = await c.auth.enviarVerificacion.execute(actorDe(req));
    res.json({ message: r2.enviado ? 'Te enviamos un nuevo enlace de verificación' : 'Tu correo ya está verificado', ...r2 });
  });

  // --- Tiempo real (SSE) y notificaciones push ---
  r.post('/eventos/ticket', auth, rateLimit(30, 60_000), (req: Request, res: Response) => {
    res.json({ ticket: c.tickets.emitir(actorDe(req)) });
  });
  r.get('/eventos', (req: Request, res: Response) => {
    const actor = c.tickets.canjear(req.query.ticket);
    if (!actor) {
      res.status(401).json({ error: 'El ticket de eventos no es válido o venció', statusCode: 401 });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    res.write(`event: conectado\ndata: ${JSON.stringify({ usuario: actor.userId })}\n\n`);
    const desuscribir = c.bus.suscribir(actor.userId, (e) => {
      res.write(`event: ${e.tipo}\ndata: ${JSON.stringify(e.datos)}\n\n`);
    });
    const latido = setInterval(() => res.write(': latido\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(latido);
      desuscribir();
    });
  });
  r.get('/push/clave-publica', (_req: Request, res: Response) => {
    res.json({ clave: c.clavePush || null });
  });
  r.post('/push/suscripciones', auth, rateLimit(20, 60_000), async (req: Request, res: Response) => {
    await c.push.suscribir.execute(actorDe(req), req.body ?? {});
    res.status(201).json({ message: 'Notificaciones activadas en este dispositivo' });
  });
  r.delete('/push/suscripciones', auth, async (req: Request, res: Response) => {
    await c.push.desuscribir.execute(actorDe(req), req.body ?? {});
    res.status(204).end();
  });

  // --- Notificaciones (cualquier rol) ---
  r.get('/notificaciones', auth, async (req: Request, res: Response) => {
    res.json(await c.notificaciones.listar.execute(actorDe(req), req.query));
  });
  r.get('/notificaciones/no-leidas', auth, async (req: Request, res: Response) => {
    res.json(await c.notificaciones.noLeidas.execute(actorDe(req)));
  });
  r.post('/notificaciones/leer-todas', auth, async (req: Request, res: Response) => {
    res.json(await c.notificaciones.leerTodas.execute(actorDe(req)));
  });
  r.post('/notificaciones/:id/leer', auth, async (req: Request, res: Response) => {
    await c.notificaciones.leer.execute(actorDe(req), req.params.id);
    res.status(204).end();
  });
  r.delete('/notificaciones', auth, async (req: Request, res: Response) => {
    res.json(await c.notificaciones.borrarLeidas.execute(actorDe(req)));
  });
  r.delete('/notificaciones/:id', auth, async (req: Request, res: Response) => {
    await c.notificaciones.borrar.execute(actorDe(req), req.params.id);
    res.status(204).end();
  });

  // --- Catálogo ---
  r.get('/zonas', auth, async (_req: Request, res: Response) => {
    res.json(await c.catalogo.zonas.execute());
  });
  r.get('/geo/buscar', auth, rateLimit(60, 60_000), async (req: Request, res: Response) => {
    res.json({ resultados: await c.catalogo.buscarDireccion.execute(req.query.q) });
  });
  r.get('/geo/inversa', auth, rateLimit(30, 60_000), async (req: Request, res: Response) => {
    res.json({ resultado: await c.catalogo.direccionDe.execute(req.query.lat, req.query.lon) });
  });
  r.post('/cotizar/cotizar', auth, autorizar(CLIENTE), async (req: Request, res: Response) => {
    const cotizacion = await c.catalogo.cotizar.execute(req.body ?? {});
    res.json({ message: 'Tarifa calculada exitosamente', ...cotizacion });
  });

  // --- Envíos (cliente) ---
  r.post('/envios/crear', auth, autorizar(CLIENTE), async (req: Request, res: Response) => {
    const envio = await c.envios.crear.execute(actorDe(req), req.body ?? {});
    res.status(201).json({ message: 'Solicitud de envío creada exitosamente', envio });
  });
  r.get('/clientes/envios', auth, autorizar(CLIENTE), async (req: Request, res: Response) => {
    const envios = await c.envios.delCliente.execute(actorDe(req), req.query.estado);
    res.json({ message: 'Envíos del cliente', envios });
  });
  r.post('/envios/:id/calificar', auth, autorizar(CLIENTE), async (req: Request, res: Response) => {
    const envio = await c.envios.calificar.execute(actorDe(req), req.params.id, req.body?.rating, req.body?.comentario);
    res.json({ message: 'Calificación registrada exitosamente', envio });
  });
  r.patch('/envios/:id', auth, autorizar(CLIENTE), async (req: Request, res: Response) => {
    res.json({ message: 'Envío actualizado', envio: await c.envios.editar.execute(actorDe(req), req.params.id, req.body ?? {}) });
  });
  r.post('/envios/:id/pago/reintentar', auth, autorizar(CLIENTE), rateLimit(10, 60_000), async (req: Request, res: Response) => {
    res.json({ message: 'Te enviamos el cobro a Nequi', pago: await c.pagos.reintentar.execute(actorDe(req), req.params.id, req.body ?? {}) });
  });
  r.post('/envios/:id/pago/efectivo', auth, autorizar(CLIENTE), async (req: Request, res: Response) => {
    res.json({ message: 'Pagarás en efectivo al conductor', pago: await c.pagos.efectivo.execute(actorDe(req), req.params.id) });
  });
  r.post('/envios/:id/cancelar', auth, autorizar(CLIENTE, ADMIN), async (req: Request, res: Response) => {
    const envio = await c.envios.cancelar.execute(actorDe(req), req.params.id, req.body?.motivo);
    res.json({ message: 'Envío cancelado', envio });
  });

  // --- Envíos (conductor) ---
  r.post('/envios/aceptar', auth, autorizar(CONDUCTOR), async (req: Request, res: Response) => {
    const envio = await c.envios.aceptar.execute(actorDe(req), req.body ?? {});
    res.json({ message: 'Servicio asignado exitosamente', envio });
  });
  r.post('/envios/:id/iniciar-ruta', auth, autorizar(CONDUCTOR), async (req: Request, res: Response) => {
    const envio = await c.envios.iniciarRuta.execute(actorDe(req), req.params.id);
    res.json({ message: 'Ruta iniciada', envio });
  });
  r.post('/envios/:id/recogida', auth, autorizar(CONDUCTOR), subirArchivo(TIPOS_FOTO), async (req: Request, res: Response) => {
    res.json({ message: 'Paquete recogido, ruta iniciada', envio: await c.envios.recoger.execute(actorDe(req), req.params.id, archivoDe(req)) });
  });
  r.post('/envios/:id/paradas/:idParada/completar', auth, autorizar(CONDUCTOR), async (req: Request, res: Response) => {
    res.json(await c.envios.completarParada.execute(actorDe(req), req.params.id, req.params.idParada));
  });
  r.post('/envios/:id/llegada-destino', auth, autorizar(CONDUCTOR), async (req: Request, res: Response) => {
    res.json({ message: 'Llegada al destino registrada', envio: await c.envios.llegadaDestino.execute(actorDe(req), req.params.id) });
  });
  r.post('/envios/:id/evidencia', auth, autorizar(CONDUCTOR), subirArchivo(TIPOS_FOTO), async (req: Request, res: Response) => {
    const resultado = await c.envios.evidencia.execute(actorDe(req), req.params.id, archivoDe(req));
    res.status(201).json(resultado);
  });
  r.post('/envios/:id/validar-entrega', auth, autorizar(CONDUCTOR), async (req: Request, res: Response) => {
    const envio = await c.envios.validarEntrega.execute(actorDe(req), req.params.id, req.body ?? {});
    res.json({ message: 'Validación de entrega exitosa', envio });
  });
  r.post('/envios/:id/ubicacion', auth, autorizar(CONDUCTOR), rateLimit(120, 60_000), async (req: Request, res: Response) => {
    await c.envios.registrarUbicacion.execute(actorDe(req), req.params.id, req.body ?? {});
    res.status(201).json({ message: 'Ubicación registrada' });
  });

  // --- Envíos (cualquier rol con acceso al envío) ---
  r.get('/envios/:id/ubicacion', auth, async (req: Request, res: Response) => {
    res.json(await c.envios.ultimaUbicacion.execute(actorDe(req), req.params.id));
  });
  r.get('/envios/:id/pago', auth, async (req: Request, res: Response) => {
    res.json(await c.pagos.estado.execute(actorDe(req), req.params.id));
  });
  r.get('/envios/:id/mensajes', auth, async (req: Request, res: Response) => {
    res.json(await c.envios.chat.execute(actorDe(req), req.params.id));
  });
  r.post('/envios/:id/mensajes', auth, autorizar(CLIENTE, CONDUCTOR), rateLimit(30, 60_000), async (req: Request, res: Response) => {
    res.status(201).json(await c.envios.enviarMensaje.execute(actorDe(req), req.params.id, req.body ?? {}));
  });
  r.get('/envios/:id/seguimiento', auth, async (req: Request, res: Response) => {
    res.json(await c.envios.seguimiento.execute(actorDe(req), req.params.id));
  });
  r.get('/envios/:id', auth, async (req: Request, res: Response) => {
    const envio = await c.envios.rastrear.execute(actorDe(req), req.params.id);
    res.json({ message: 'Trazabilidad del envío', envio });
  });

  // --- Conductores ---
  r.get('/conductores/me', auth, autorizar(CONDUCTOR), async (req: Request, res: Response) => {
    res.json(await c.conductores.perfil.execute(actorDe(req)));
  });
  r.get('/conductores/me/resumen', auth, autorizar(CONDUCTOR), async (req: Request, res: Response) => {
    res.json(await c.conductores.resumen.execute(actorDe(req)));
  });
  r.get('/conductores/me/billetera', auth, autorizar(CONDUCTOR), async (req: Request, res: Response) => {
    res.json(await c.pagos.billetera.execute(actorDe(req)));
  });
  r.get('/conductores/envios/historial', auth, autorizar(CONDUCTOR), async (req: Request, res: Response) => {
    res.json({ envios: await c.conductores.historial.execute(actorDe(req), req.query.limite) });
  });
  r.get('/conductores/envios/disponibles', auth, autorizar(CONDUCTOR), async (req: Request, res: Response) => {
    res.json({ message: 'Envíos disponibles', envios: await c.envios.disponibles.execute(actorDe(req)) });
  });
  r.get('/conductores/envios/activo', auth, autorizar(CONDUCTOR), async (req: Request, res: Response) => {
    res.json({ envio: await c.envios.activo.execute(actorDe(req)) });
  });
  r.post('/vehicles/register', auth, autorizar(CONDUCTOR), async (req: Request, res: Response) => {
    const vehicle = await c.conductores.registrarVehiculo.execute(actorDe(req), req.body ?? {});
    res.status(201).json({ message: 'Vehículo registrado exitosamente', vehicle });
  });
  r.post('/documentos/upload', auth, autorizar(CONDUCTOR), subirArchivo(TIPOS_ARCHIVO_DOCUMENTO), async (req: Request, res: Response) => {
    const documento = await c.conductores.subirDocumento.execute(actorDe(req), req.body ?? {}, archivoDe(req));
    res.status(201).json({ message: 'Documento subido exitosamente', documento });
  });

  // --- Administración ---
  r.get('/conductores/pendientes', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    res.json(await c.conductores.postulantes.execute(actorDe(req)));
  });
  r.post('/conductores/aprobar', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    const driver = await c.conductores.decidir.execute(actorDe(req), req.body ?? {});
    res.json({ message: driver.estado_aprobacion === 'Aprobado' ? 'Conductor aprobado exitosamente' : 'Conductor rechazado exitosamente', driver });
  });
  r.get('/admin/dashboard/metrics', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    res.json(await c.admin.metricas.execute(actorDe(req)));
  });
  r.get('/admin/auditoria', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    res.json(await c.admin.auditoria.execute(actorDe(req), req.query));
  });
  r.get('/admin/envios', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    res.json(await c.admin.envios.execute(actorDe(req), req.query));
  });
  r.get('/admin/zonas', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    res.json(await c.admin.zonas.execute(actorDe(req)));
  });
  r.post('/admin/zonas', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    res.status(201).json({ message: 'Zona creada', zona: await c.admin.crearZona.execute(actorDe(req), req.body ?? {}) });
  });
  r.put('/admin/tarifas/:categoria', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    res.json({ message: 'Tarifa actualizada', tarifa: await c.admin.tarifaVehiculo.execute(actorDe(req), req.params.categoria, req.body ?? {}) });
  });
  r.put('/admin/zonas/:id', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    res.json({ message: 'Zona actualizada', zona: await c.admin.tarifa.execute(actorDe(req), req.params.id, req.body ?? {}) });
  });
  r.delete('/admin/zonas/:id', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    const r2 = await c.admin.borrarZona.execute(actorDe(req), req.params.id);
    res.json({ message: r2.resultado === 'borrada' ? 'Zona eliminada' : 'Zona eliminada (se conserva en el historial de envíos)', ...r2 });
  });
  r.get('/admin/pagos', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    res.json(await c.pagos.listar.execute(actorDe(req), req.query));
  });
  r.post('/admin/pagos/:idEnvio/reembolso', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    res.json({ message: 'Reembolso procesado', pago: await c.pagos.reembolso.execute(actorDe(req), req.params.idEnvio) });
  });
  r.get('/admin/liquidaciones', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    res.json(await c.pagos.liquidaciones.execute(actorDe(req), req.query));
  });
  r.post('/admin/liquidaciones/generar', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    const creadas = await c.pagos.generarLiquidaciones.execute(actorDe(req), req.body ?? {});
    res.status(201).json({ message: creadas.length ? `Se generaron ${creadas.length} liquidaciones` : 'No hay entregas pendientes por liquidar', liquidaciones: creadas });
  });
  r.post('/admin/liquidaciones/:id/pagar', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    res.json({ message: 'Liquidación pagada', liquidacion: await c.pagos.pagarLiquidacion.execute(actorDe(req), req.params.id, req.body ?? {}) });
  });
  r.get('/admin/contactos', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    res.json(await c.admin.contactos.execute(actorDe(req), req.query));
  });
  r.post('/admin/contactos/:id/atender', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    await c.admin.atenderContacto.execute(actorDe(req), req.params.id);
    res.status(204).end();
  });
  r.delete('/admin/contactos/:id', auth, autorizar(ADMIN), async (req: Request, res: Response) => {
    await c.admin.borrarContacto.execute(actorDe(req), req.params.id);
    res.status(204).end();
  });

  return r;
}
