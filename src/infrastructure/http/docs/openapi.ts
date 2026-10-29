/* Especificación OpenAPI 3.0 de la API de TrackIt Express. Se sirve en /api/docs (Swagger UI) y /api/docs.json. */

const error = (descripcion: string, ejemplo: string) => ({
  description: descripcion,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: ejemplo, statusCode: 400 } } },
});

const E400 = (ejemplo = 'Error de validación') => error('Datos inválidos o regla de negocio incumplida', ejemplo);
const E401 = error('Falta el token o es inválido', 'Token inválido o vencido');
const E403 = error('El rol o el usuario no tiene permiso', 'No tienes permiso para realizar esta acción');
const E404 = (ejemplo = 'Recurso no encontrado') => error('No existe', ejemplo);
const json = (schema: object, example?: unknown) => ({ 'application/json': { schema, ...(example !== undefined ? { example } : {}) } });
const ref = (nombre: string) => ({ $ref: `#/components/schemas/${nombre}` });
const seguro = [{ bearerAuth: [] }];
const idEnvio = { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 }, description: 'id_envio' };

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'TrackIt Express API',
    version: '2.0.0',
    description:
      'API de envíos y logística local en Fusagasugá y alrededores.\n\n' +
      'Autenticación: inicia sesión en `POST /api/auth/login`, copia el `token` y pulsa **Authorize**. ' +
      'Roles: 1 Administrador, 2 Cliente, 3 Conductor.\n\n' +
      'Errores: todos responden `{ "error": "mensaje", "statusCode": 400 }`.',
  },
  servers: [{ url: '/', description: 'Este servidor' }],
  tags: [
    { name: 'Autenticación' },
    { name: 'Catálogo' },
    { name: 'Envíos (cliente)' },
    { name: 'Envíos (conductor)' },
    { name: 'Seguimiento' },
    { name: 'Conductores' },
    { name: 'Administración' },
    { name: 'Sistema' },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'string' }, statusCode: { type: 'integer' } }, required: ['error'] },
      Usuario: {
        type: 'object',
        properties: { id: { type: 'integer' }, nombre: { type: 'string' }, correo: { type: 'string' }, rol: { type: 'string', enum: ['1', '2', '3'] } },
      },
      Estado: { type: 'string', enum: ['Pendiente', 'Asignado', 'En Ruta', 'Entregado'] },
      Categoria: { type: 'string', enum: ['Moto Express', 'Motocarro', 'Camioneta'] },
      Envio: {
        type: 'object',
        properties: {
          id_envio: { type: 'integer', example: 12 },
          origen: { type: 'string', example: 'Casco Urbano, Cra 6 #8-20' },
          destino: { type: 'string', example: 'Silvania' },
          tipo_carga: { type: 'string', example: 'Documentos' },
          tarifa: { type: 'number', example: 39500 },
          pin_seguridad: { type: 'string', example: '4821', description: 'Solo se entrega al cliente dueño del envío' },
          estado: ref('Estado'),
          id_cliente: { type: 'integer' },
          id_conductor: { type: 'integer', nullable: true },
          id_zona: { type: 'integer' },
          categoria: { allOf: [ref('Categoria')], nullable: true },
          fecha_creacion: { type: 'string', format: 'date-time' },
          fecha_ultimo_cambio: { type: 'string', format: 'date-time' },
          ultimo_cambio_estado: ref('Estado'),
          historial_estado: {
            type: 'array',
            description: 'Del más reciente al más antiguo',
            items: { type: 'object', properties: { estado: ref('Estado'), fecha: { type: 'string', format: 'date-time' } } },
          },
          calificado: { type: 'boolean' },
          calificacion: { type: 'number', nullable: true },
          conductor: {
            type: 'object',
            nullable: true,
            properties: {
              nombre: { type: 'string' },
              placa: { type: 'string', nullable: true },
              vehiculo: { allOf: [ref('Categoria')], nullable: true },
              calificacion_promedio: { type: 'number', nullable: true },
            },
          },
        },
      },
      Postulante: {
        type: 'object',
        properties: {
          id_conductor: { type: 'integer' },
          nombre: { type: 'string' },
          correo: { type: 'string' },
          estado_aprobacion: { type: 'string', enum: ['Pendiente', 'Aprobado', 'Rechazado'] },
          motivo_rechazo: { type: 'string', nullable: true },
          documentos: {
            type: 'array',
            items: { type: 'object', properties: { tipo_documento: { type: 'string', enum: ['Cédula', 'SOAT', 'Licencia'] }, url_archivo: { type: 'string' } } },
          },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: { tags: ['Sistema'], summary: 'Estado del servidor y de la base de datos', responses: { '200': { description: 'Funcionando' }, '503': { description: 'Sin base de datos' } } },
    },
    '/api/auth/register': {
      post: {
        tags: ['Autenticación'],
        summary: 'Registrar cliente o conductor (CU-001)',
        description: 'Con `id_rol` 3 se crea también el perfil de conductor en estado Pendiente. No se pueden crear administradores.',
        requestBody: {
          required: true,
          content: json(
            {
              type: 'object',
              required: ['nombre', 'correo', 'password', 'id_rol'],
              properties: {
                nombre: { type: 'string', maxLength: 120 },
                correo: { type: 'string', format: 'email' },
                password: { type: 'string', minLength: 8, description: 'Al menos una mayúscula y un número' },
                id_rol: { type: 'integer', enum: [2, 3] },
              },
            },
            { nombre: 'Ana Gómez', correo: 'ana@correo.co', password: 'Clave1234', id_rol: 2 },
          ),
        },
        responses: {
          '201': { description: 'Creado', content: json({ type: 'object', properties: { message: { type: 'string' }, user: ref('Usuario') } }) },
          '400': E400('El correo ya está registrado'),
          '429': error('Demasiados intentos', 'Demasiadas peticiones, intenta más tarde'),
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Autenticación'],
        summary: 'Iniciar sesión (CU-002)',
        requestBody: { required: true, content: json({ type: 'object', required: ['correo', 'password'], properties: { correo: { type: 'string' }, password: { type: 'string' } } }, { correo: 'admin@trackit.com.co', password: 'Admin2026*' }) },
        responses: {
          '200': { description: 'Token JWT', content: json({ type: 'object', properties: { message: { type: 'string' }, user: ref('Usuario'), token: { type: 'string' } } }) },
          '401': error('Credenciales incorrectas', 'Credenciales inválidas'),
          '429': error('Demasiados intentos', 'Demasiadas peticiones, intenta más tarde'),
        },
      },
    },
    '/api/zonas': {
      get: {
        tags: ['Catálogo'],
        summary: 'Zonas de tarifa',
        security: seguro,
        responses: {
          '200': { description: 'Zonas', content: json({ type: 'array', items: { type: 'object', properties: { id_zona: { type: 'integer' }, nombre_zona: { type: 'string' }, tarifa_base: { type: 'number' } } } }) },
          '401': E401,
        },
      },
    },
    '/api/cotizar/cotizar': {
      post: {
        tags: ['Catálogo'],
        summary: 'Cotizar un envío (CU-005) · Cliente',
        description: 'tarifa_total = tarifa_base de la zona + distancia_km × 1.000 COP. La distancia es estimada (OpenStreetMap).',
        security: seguro,
        requestBody: { required: true, content: json({ type: 'object', required: ['origen', 'destino', 'id_zona'], properties: { origen: { type: 'string' }, destino: { type: 'string' }, id_zona: { type: 'integer' } } }, { origen: 'Casco Urbano', destino: 'Silvania', id_zona: 1 }) },
        responses: {
          '200': { description: 'Cotización', content: json({ type: 'object', properties: { distancia_km: { type: 'number' }, tarifa_base: { type: 'number' }, tarifa_total: { type: 'number' }, moneda: { type: 'string' } } }) },
          '400': E400(),
          '401': E401,
          '403': E403,
          '404': E404('No existe la zona de tarifa con id 9'),
        },
      },
    },
    '/api/envios/crear': {
      post: {
        tags: ['Envíos (cliente)'],
        summary: 'Solicitar un envío (CU-006) · Cliente',
        description: 'El cliente se toma del token. Genera un PIN de 4 dígitos que solo ve el cliente.',
        security: seguro,
        requestBody: {
          required: true,
          content: json(
            { type: 'object', required: ['origen', 'destino', 'tipo_carga', 'id_zona'], properties: { origen: { type: 'string' }, destino: { type: 'string' }, tipo_carga: { type: 'string', maxLength: 80 }, id_zona: { type: 'integer' }, categoria: ref('Categoria') } },
            { origen: 'Casco Urbano', destino: 'Silvania', tipo_carga: 'Documentos', id_zona: 1 },
          ),
        },
        responses: { '201': { description: 'Creado', content: json({ type: 'object', properties: { message: { type: 'string' }, envio: ref('Envio') } }) }, '400': E400(), '401': E401, '403': E403, '404': E404() },
      },
    },
    '/api/clientes/envios': {
      get: {
        tags: ['Envíos (cliente)'],
        summary: 'Mis envíos (E6-HU2) · Cliente',
        security: seguro,
        parameters: [{ name: 'estado', in: 'query', schema: { type: 'string', enum: ['activos', 'historial', 'Pendiente', 'Asignado', 'En Ruta', 'Entregado'] } }],
        responses: { '200': { description: 'Del más reciente al más antiguo', content: json({ type: 'object', properties: { envios: { type: 'array', items: ref('Envio') } } }) }, '401': E401, '403': E403 },
      },
    },
    '/api/envios/{id}': {
      get: {
        tags: ['Seguimiento'],
        summary: 'Trazabilidad (CU-008)',
        description: 'Acceso: cliente dueño, conductor asignado, administrador, o conductor aprobado si el envío está disponible. El PIN solo se incluye para el cliente dueño.',
        security: seguro,
        parameters: [idEnvio],
        responses: { '200': { description: 'Envío con historial', content: json({ type: 'object', properties: { envio: ref('Envio') } }) }, '400': E400(), '401': E401, '403': E403, '404': E404('No existe el envío con id 99') },
      },
    },
    '/api/envios/{id}/calificar': {
      post: {
        tags: ['Envíos (cliente)'],
        summary: 'Calificar el servicio (CU-010) · Cliente dueño',
        security: seguro,
        parameters: [idEnvio],
        requestBody: { required: true, content: json({ type: 'object', required: ['rating'], properties: { rating: { type: 'integer', minimum: 1, maximum: 5 } } }, { rating: 5 }) },
        responses: { '200': { description: 'Registrada' }, '400': E400('Este envío ya fue calificado'), '401': E401, '403': E403, '404': E404() },
      },
    },
    '/api/envios/aceptar': {
      post: {
        tags: ['Envíos (conductor)'],
        summary: 'Aceptar un servicio (CU-007) · Conductor aprobado',
        description: 'Un conductor solo puede tener un servicio activo. Si el envío pide categoría, el conductor debe tener un vehículo de esa categoría.',
        security: seguro,
        requestBody: { required: true, content: json({ type: 'object', required: ['id_envio'], properties: { id_envio: { type: 'integer' } } }, { id_envio: 12 }) },
        responses: { '200': { description: 'Asignado', content: json({ type: 'object', properties: { envio: ref('Envio') } }) }, '400': E400('Este envío ya fue tomado por otro conductor'), '401': E401, '403': E403, '404': E404() },
      },
    },
    '/api/envios/{id}/iniciar-ruta': {
      post: { tags: ['Envíos (conductor)'], summary: 'Iniciar ruta: Asignado → En Ruta · Conductor asignado', security: seguro, parameters: [idEnvio], responses: { '200': { description: 'En Ruta' }, '400': E400(), '401': E401, '403': E403, '404': E404() } },
    },
    '/api/envios/{id}/evidencia': {
      post: {
        tags: ['Envíos (conductor)'],
        summary: 'Subir la foto de entrega · Conductor asignado',
        description: 'multipart/form-data, campo `archivo` (JPG o PNG, máximo 5 MB). Devuelve la URL para validar la entrega.',
        security: seguro,
        parameters: [idEnvio],
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { archivo: { type: 'string', format: 'binary' } } } } } },
        responses: { '201': { description: 'URL de la foto', content: json({ type: 'object', properties: { url_foto: { type: 'string' } } }) }, '400': E400('La foto debe ser JPG o PNG'), '401': E401, '403': E403 },
      },
    },
    '/api/envios/{id}/validar-entrega': {
      post: {
        tags: ['Envíos (conductor)'],
        summary: 'Validar la entrega con PIN y evidencia (CU-009) · Conductor asignado',
        security: seguro,
        parameters: [idEnvio],
        requestBody: { required: true, content: json({ type: 'object', required: ['url_foto', 'pin_seguridad'], properties: { url_foto: { type: 'string' }, pin_seguridad: { type: 'string' } } }) },
        responses: { '200': { description: 'Entregado' }, '400': E400('PIN incorrecto'), '401': E401, '403': E403, '404': E404() },
      },
    },
    '/api/envios/{id}/ubicacion': {
      post: {
        tags: ['Envíos (conductor)'],
        summary: 'Reportar la ubicación (CU-008) · Conductor asignado',
        security: seguro,
        parameters: [idEnvio],
        requestBody: { required: true, content: json({ type: 'object', required: ['lat', 'lon'], properties: { lat: { type: 'number' }, lon: { type: 'number' }, capturado_en: { type: 'string', format: 'date-time' } } }, { lat: 4.3369, lon: -74.3638, capturado_en: '2026-10-29T15:00:00Z' }) },
        responses: { '201': { description: 'Registrada' }, '400': E400('Coordenadas fuera de rango'), '401': E401, '403': E403 },
      },
      get: {
        tags: ['Seguimiento'],
        summary: 'Última ubicación del conductor',
        security: seguro,
        parameters: [idEnvio],
        responses: { '200': { description: 'Posición o null', content: json({ type: 'object', nullable: true, properties: { lat: { type: 'number' }, lon: { type: 'number' }, capturado_en: { type: 'string' } } }) }, '401': E401, '403': E403, '404': E404() },
      },
    },
    '/api/conductores/me': {
      get: {
        tags: ['Conductores'],
        summary: 'Mi perfil de conductor · Conductor',
        security: seguro,
        responses: {
          '200': {
            description: 'Perfil',
            content: json({ type: 'object', properties: { id_conductor: { type: 'integer' }, estado_aprobacion: { type: 'string' }, motivo_rechazo: { type: 'string', nullable: true }, vehiculo: { type: 'object', nullable: true, properties: { id: { type: 'integer' }, placa: { type: 'string' }, categoria: ref('Categoria') } } } }),
          },
          '401': E401,
          '403': E403,
        },
      },
    },
    '/api/conductores/envios/disponibles': {
      get: { tags: ['Conductores'], summary: 'Tablero de servicios (CU-007) · Conductor aprobado', security: seguro, responses: { '200': { description: 'Envíos Pendiente sin conductor, sin PIN', content: json({ type: 'object', properties: { envios: { type: 'array', items: ref('Envio') } } }) }, '401': E401, '403': E403 } },
    },
    '/api/conductores/envios/activo': {
      get: { tags: ['Conductores'], summary: 'Servicio en curso del conductor', security: seguro, responses: { '200': { description: 'Envío o null', content: json({ type: 'object', properties: { envio: { allOf: [ref('Envio')], nullable: true } } }) }, '401': E401, '403': E403 } },
    },
    '/api/vehicles/register': {
      post: {
        tags: ['Conductores'],
        summary: 'Registrar vehículo (CU-003) · Conductor',
        security: seguro,
        requestBody: { required: true, content: json({ type: 'object', required: ['placa', 'categoria'], properties: { placa: { type: 'string', example: 'ABC12D' }, categoria: ref('Categoria') } }) },
        responses: { '201': { description: 'Registrado' }, '400': E400('La placa ya está registrada'), '401': E401, '403': E403 },
      },
    },
    '/api/documentos/upload': {
      post: {
        tags: ['Conductores'],
        summary: 'Cargar documento (CU-004) · Conductor',
        security: seguro,
        requestBody: {
          required: true,
          content: { 'multipart/form-data': { schema: { type: 'object', required: ['archivo', 'tipo_documento'], properties: { archivo: { type: 'string', format: 'binary' }, tipo_documento: { type: 'string', enum: ['Cédula', 'SOAT', 'Licencia'] } } } } },
        },
        responses: { '201': { description: 'Recibido' }, '400': E400('El archivo supera el tamaño máximo de 5 MB'), '401': E401, '403': E403 },
      },
    },
    '/api/conductores/pendientes': {
      get: { tags: ['Administración'], summary: 'Conductores por aprobar (CU-011) · Administrador', security: seguro, responses: { '200': { description: 'Pendientes y rechazados con documentos', content: json({ type: 'array', items: ref('Postulante') }) }, '401': E401, '403': E403 } },
    },
    '/api/conductores/aprobar': {
      post: {
        tags: ['Administración'],
        summary: 'Aprobar o rechazar conductor (CU-011) · Administrador',
        security: seguro,
        requestBody: { required: true, content: json({ type: 'object', required: ['driverId', 'approved'], properties: { driverId: { type: 'integer' }, approved: { type: 'boolean' }, observation: { type: 'string', maxLength: 255, description: 'Obligatorio al rechazar' } } }, { driverId: 1, approved: false, observation: 'El SOAT está vencido' }) },
        responses: { '200': { description: 'Decisión registrada', content: json({ type: 'object', properties: { driver: ref('Postulante') } }) }, '400': E400('Este conductor ya ha sido aprobado previamente'), '401': E401, '403': E403, '404': E404('No existe el conductor con id 77') },
      },
    },
    '/api/admin/dashboard/metrics': {
      get: { tags: ['Administración'], summary: 'Métricas del panel (E7-HU2) · Administrador', security: seguro, responses: { '200': { description: 'KPI, envíos por zona y por estado' }, '401': E401, '403': E403 } },
    },
    '/api/admin/auditoria': {
      get: {
        tags: ['Administración'],
        summary: 'Auditoría paginada (E7-HU2) · Administrador',
        security: seguro,
        parameters: [
          { name: 'pagina', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'tamano', in: 'query', schema: { type: 'integer', default: 15, maximum: 1000 } },
          { name: 'texto', in: 'query', schema: { type: 'string' } },
          { name: 'accion', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: '{ items, total, pagina, tamano }' }, '401': E401, '403': E403 },
      },
    },
    '/api/logs/frontend': {
      post: {
        tags: ['Sistema'],
        summary: 'Recibir logs del frontend',
        description: 'Escribe en logs/frontend-AAAA-MM-DD.txt. Máximo 50 eventos por lote y 30 lotes por minuto por IP.',
        requestBody: { required: true, content: json({ type: 'object', properties: { eventos: { type: 'array', items: { type: 'object', required: ['nivel', 'mensaje'], properties: { nivel: { type: 'string', enum: ['DEBUG', 'INFO', 'WARN', 'ERROR'] }, mensaje: { type: 'string' }, contexto: { type: 'string' }, fecha: { type: 'string' }, url: { type: 'string' }, meta: { type: 'object' } } } } } }) },
        responses: { '202': { description: '{ recibidos, descartados }' }, '400': E400(), '429': error('Demasiados lotes', 'Demasiadas peticiones, intenta más tarde') },
      },
    },
  },
} as const;
