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

  // --- Catálogo ---
  r.get('/zonas', auth, async (_req: Request, res: Response) => {
    const zonas = await c.catalogo.zonas.execute();
    res.json(zonas.map((z) => ({ id_zona: z.id_zona, nombre_zona: z.nombre_zona, tarifa_base: z.tarifa_base })));
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
    const envio = await c.envios.calificar.execute(actorDe(req), req.params.id, req.body?.rating);
    res.json({ message: 'Calificación registrada exitosamente', envio });
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
  r.get('/envios/:id', auth, async (req: Request, res: Response) => {
    const envio = await c.envios.rastrear.execute(actorDe(req), req.params.id);
    res.json({ message: 'Trazabilidad del envío', envio });
  });

  // --- Conductores ---
  r.get('/conductores/me', auth, autorizar(CONDUCTOR), async (req: Request, res: Response) => {
    res.json(await c.conductores.perfil.execute(actorDe(req)));
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

  return r;
}
