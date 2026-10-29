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
const idPath = (descripcion: string) => ({ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 }, description: descripcion });
const pagina = [
  { name: 'pagina', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'tamano', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 15 } },
];
const coords = { type: 'object', nullable: true, properties: { lat: { type: 'number' }, lon: { type: 'number' } } };
const punto = { type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' }, capturado_en: { type: 'string', format: 'date-time' } } };

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
    { name: 'Sitio público', description: 'Sin sesión: cifras, zonas y formulario de contacto' },
    { name: 'Mi cuenta', description: 'Perfil y contraseña del usuario autenticado' },
    { name: 'Notificaciones', description: 'Avisos de cambios en envíos y en la cuenta' },
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
      Estado: { type: 'string', enum: ['Pendiente', 'Asignado', 'En Ruta', 'Entregado', 'Cancelado'] },
      Perfil: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          nombre: { type: 'string' },
          correo: { type: 'string' },
          rol: { type: 'string', enum: ['1', '2', '3'] },
          nombre_rol: { type: 'string', example: 'Cliente' },
          telefono: { type: 'string', nullable: true, example: '3105551234' },
          fecha_registro: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      Notificacion: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          tipo: {
            type: 'string',
            enum: ['envio_aceptado', 'ruta_iniciada', 'envio_entregado', 'envio_cancelado', 'conductor_aprobado', 'conductor_rechazado', 'calificacion_recibida'],
          },
          titulo: { type: 'string' },
          mensaje: { type: 'string' },
          id_envio: { type: 'integer', nullable: true },
          leida: { type: 'boolean' },
          fecha: { type: 'string', format: 'date-time' },
        },
      },
      Seguimiento: {
        type: 'object',
        properties: {
          id_envio: { type: 'integer' },
          estado: ref('Estado'),
          origen: { type: 'object', properties: { direccion: { type: 'string' }, coords } },
          destino: { type: 'object', properties: { direccion: { type: 'string' }, coords } },
          ultima_ubicacion: { ...punto, nullable: true },
          recorrido: { type: 'array', items: punto, description: 'Últimas 300 posiciones, en orden cronológico' },
          en_vivo: { type: 'boolean', description: 'La última posición tiene menos de 2 minutos' },
          distancia_restante_km: { type: 'number', nullable: true },
          eta_minutos: { type: 'number', nullable: true, description: 'Asignado: hasta recoger y entregar. En Ruta: hasta el destino.' },
        },
      },
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
          distancia_km: { type: 'number', nullable: true },
          notas: { type: 'string', nullable: true, description: 'Indicaciones del cliente para el conductor' },
          motivo_cancelacion: { type: 'string', nullable: true, description: 'Solo en envíos cancelados' },
          origen_coords: coords,
          destino_coords: coords,
          ganancia_conductor: { type: 'number', description: 'Solo en la vista del conductor: tarifa menos la comisión del 20 %' },
          fecha_ultimo_cambio: { type: 'string', format: 'date-time' },
          ultimo_cambio_estado: ref('Estado'),
          historial_estado: {
            type: 'array',
            description: 'Del más reciente al más antiguo',
            items: { type: 'object', properties: { estado: ref('Estado'), fecha: { type: 'string', format: 'date-time' } } },
          },
          calificado: { type: 'boolean' },
          calificacion: { type: 'number', nullable: true },
          comentario: { type: 'string', nullable: true },
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
          '200': {
            description: 'Cotización',
            content: json({
              type: 'object',
              properties: {
                distancia_km: { type: 'number' },
                tarifa_base: { type: 'number' },
                tarifa_total: { type: 'number' },
                moneda: { type: 'string' },
                duracion_estimada_min: { type: 'integer' },
                distancia_exacta: { type: 'boolean', description: 'false si alguna dirección no se encontró en el mapa' },
              },
            }),
          },
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
            {
              type: 'object',
              required: ['origen', 'destino', 'tipo_carga', 'id_zona'],
              properties: {
                origen: { type: 'string' },
                destino: { type: 'string' },
                tipo_carga: { type: 'string', maxLength: 80 },
                id_zona: { type: 'integer' },
                categoria: ref('Categoria'),
                notas: { type: 'string', maxLength: 300, description: 'Indicaciones para el conductor' },
              },
            },
            { origen: 'Casco Urbano', destino: 'Silvania', tipo_carga: 'Documentos', id_zona: 1, notas: 'Dejar en portería' },
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
        parameters: [{ name: 'estado', in: 'query', schema: { type: 'string', enum: ['activos', 'historial', 'Pendiente', 'Asignado', 'En Ruta', 'Entregado', 'Cancelado'] } }],
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
        description: 'Avisa al conductor con una notificación.',
        requestBody: {
          required: true,
          content: json(
            { type: 'object', required: ['rating'], properties: { rating: { type: 'integer', minimum: 1, maximum: 5 }, comentario: { type: 'string', maxLength: 300 } } },
            { rating: 5, comentario: 'Muy puntual' },
          ),
        },
        responses: { '200': { description: 'Registrada' }, '400': E400('Este envío ya fue calificado'), '401': E401, '403': E403, '404': E404() },
      },
    },
    '/api/envios/{id}/cancelar': {
      post: {
        tags: ['Envíos (cliente)'],
        summary: 'Cancelar un envío · Cliente dueño o Administrador',
        description:
          'El cliente puede cancelar mientras el envío está Pendiente (motivo opcional). El administrador puede cancelar Pendiente, Asignado o En Ruta con motivo obligatorio. ' +
          'Se notifica al conductor asignado y, si cancela el administrador, también al cliente.',
        security: seguro,
        parameters: [idEnvio],
        requestBody: { content: json({ type: 'object', properties: { motivo: { type: 'string', maxLength: 255 } } }, { motivo: 'Ya no lo necesito' }) },
        responses: {
          '200': { description: 'Cancelado', content: json({ type: 'object', properties: { message: { type: 'string' }, envio: ref('Envio') } }) },
          '400': E400('Solo puedes cancelar un envío mientras ningún conductor lo ha tomado'),
          '401': E401,
          '403': E403,
          '404': E404(),
        },
      },
    },
    '/api/envios/{id}/seguimiento': {
      get: {
        tags: ['Seguimiento'],
        summary: 'Mapa en tiempo real: recorrido, señal en vivo y tiempo estimado de llegada',
        description: 'Acceso: cliente dueño, conductor asignado o administrador.',
        security: seguro,
        parameters: [idEnvio],
        responses: { '200': { description: 'Seguimiento', content: json(ref('Seguimiento')) }, '401': E401, '403': E403, '404': E404() },
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
        description: 'multipart/form-data, campo `archivo` (JPG, PNG o WebP, máximo 5 MB). Devuelve la URL para validar la entrega.',
        security: seguro,
        parameters: [idEnvio],
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { archivo: { type: 'string', format: 'binary' } } } } } },
        responses: { '201': { description: 'URL de la foto', content: json({ type: 'object', properties: { url_foto: { type: 'string' } } }) }, '400': E400('La foto debe ser JPG, PNG o WebP'), '401': E401, '403': E403 },
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
    '/api/conductores/me/resumen': {
      get: {
        tags: ['Conductores'],
        summary: 'Resumen del conductor: servicios, ganancias (80 % de la tarifa) y reputación',
        security: seguro,
        responses: {
          '200': {
            description: 'Resumen',
            content: json(
              {
                type: 'object',
                properties: {
                  completados: { type: 'integer' },
                  ingresos_total: { type: 'number' },
                  ingresos_mes: { type: 'number' },
                  calificacion_promedio: { type: 'number', nullable: true },
                  total_calificaciones: { type: 'integer' },
                  servicio_activo: { type: 'integer', nullable: true },
                },
              },
              { completados: 12, ingresos_total: 380000, ingresos_mes: 95000, calificacion_promedio: 4.8, total_calificaciones: 10, servicio_activo: null },
            ),
          },
          '401': E401,
          '403': E403,
        },
      },
    },
    '/api/conductores/envios/historial': {
      get: {
        tags: ['Conductores'],
        summary: 'Servicios terminados (entregados o cancelados) con calificación y comentario',
        security: seguro,
        parameters: [{ name: 'limite', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } }],
        responses: { '200': { description: 'Del más reciente al más antiguo', content: json({ type: 'object', properties: { envios: { type: 'array', items: ref('Envio') } } }) }, '401': E401, '403': E403 },
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
    '/api/admin/envios': {
      get: {
        tags: ['Administración'],
        summary: 'Todos los envíos con filtros',
        description: '`texto` busca por id, direcciones, nombre o correo del cliente y nombre del conductor.',
        security: seguro,
        parameters: [
          ...pagina,
          { name: 'estado', in: 'query', schema: ref('Estado') },
          { name: 'id_zona', in: 'query', schema: { type: 'integer' } },
          { name: 'texto', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: '{ items, total, pagina, tamano }' }, '400': E400('Filtro de estado inválido'), '401': E401, '403': E403 },
      },
    },
    '/api/admin/zonas/{id}': {
      put: {
        tags: ['Administración'],
        summary: 'Cambiar la tarifa base de una zona',
        security: seguro,
        parameters: [idPath('id_zona')],
        requestBody: { required: true, content: json({ type: 'object', required: ['tarifa_base'], properties: { tarifa_base: { type: 'number', minimum: 0 } } }, { tarifa_base: 6000 }) },
        responses: { '200': { description: 'Zona actualizada' }, '400': E400(), '401': E401, '403': E403, '404': E404() },
      },
    },
    '/api/admin/contactos': {
      get: {
        tags: ['Administración'],
        summary: 'Mensajes del formulario de contacto',
        security: seguro,
        parameters: [...pagina, { name: 'pendientes', in: 'query', schema: { type: 'boolean' } }],
        responses: { '200': { description: '{ items, total, pagina, tamano }' }, '401': E401, '403': E403 },
      },
    },
    '/api/admin/contactos/{id}/atender': {
      post: { tags: ['Administración'], summary: 'Marcar un mensaje como atendido', security: seguro, parameters: [idPath('id del mensaje')], responses: { '204': { description: 'Atendido' }, '401': E401, '403': E403, '404': E404() } },
    },
    '/api/publico/estadisticas': {
      get: {
        tags: ['Sitio público'],
        summary: 'Cifras para la página de inicio',
        responses: {
          '200': {
            description: 'Se actualizan cada minuto',
            content: json(
              { type: 'object', properties: { enviosEntregados: { type: 'integer' }, conductoresActivos: { type: 'integer' }, zonasCubiertas: { type: 'integer' }, calificacionPromedio: { type: 'number' } } },
              { enviosEntregados: 1240, conductoresActivos: 38, zonasCubiertas: 5, calificacionPromedio: 4.8 },
            ),
          },
        },
      },
    },
    '/api/publico/zonas': {
      get: { tags: ['Sitio público'], summary: 'Zonas de cobertura con su tarifa base', responses: { '200': { description: 'Zonas' } } },
    },
    '/api/contacto': {
      post: {
        tags: ['Sitio público'],
        summary: 'Formulario de contacto (máximo 5 por minuto por IP)',
        requestBody: {
          required: true,
          content: json(
            {
              type: 'object',
              required: ['nombre', 'correo', 'mensaje'],
              properties: {
                nombre: { type: 'string' },
                correo: { type: 'string', format: 'email' },
                telefono: { type: 'string' },
                asunto: { type: 'string', enum: ['General', 'Empresas', 'Conductores', 'Soporte'] },
                mensaje: { type: 'string', minLength: 10, maxLength: 1000 },
              },
            },
            { nombre: 'Ana Ruiz', correo: 'ana@tienda.co', asunto: 'Empresas', mensaje: 'Quiero cotizar envíos diarios para mi tienda.' },
          ),
        },
        responses: { '201': { description: 'Recibido' }, '400': E400(), '429': error('Demasiados mensajes', 'Demasiadas peticiones, intenta más tarde') },
      },
    },
    '/api/usuarios/me': {
      get: { tags: ['Mi cuenta'], summary: 'Mi perfil', security: seguro, responses: { '200': { description: 'Perfil', content: json(ref('Perfil')) }, '401': E401 } },
      patch: {
        tags: ['Mi cuenta'],
        summary: 'Actualizar nombre y teléfono',
        security: seguro,
        requestBody: { required: true, content: json({ type: 'object', properties: { nombre: { type: 'string' }, telefono: { type: 'string', nullable: true } } }, { nombre: 'Laura Méndez', telefono: '3105551234' }) },
        responses: { '200': { description: 'Actualizado' }, '400': E400('El teléfono debe tener entre 7 y 15 dígitos'), '401': E401 },
      },
    },
    '/api/usuarios/me/password': {
      post: {
        tags: ['Mi cuenta'],
        summary: 'Cambiar la contraseña',
        security: seguro,
        requestBody: { required: true, content: json({ type: 'object', required: ['actual', 'nueva'], properties: { actual: { type: 'string' }, nueva: { type: 'string', minLength: 8 } } }) },
        responses: { '200': { description: 'Actualizada' }, '400': E400('La contraseña actual no es correcta'), '401': E401 },
      },
    },
    '/api/notificaciones': {
      get: {
        tags: ['Notificaciones'],
        summary: 'Mis notificaciones',
        security: seguro,
        parameters: [
          { name: 'no_leidas', in: 'query', schema: { type: 'boolean' } },
          { name: 'limite', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 30 } },
        ],
        responses: {
          '200': { description: 'Más recientes primero', content: json({ type: 'object', properties: { no_leidas: { type: 'integer' }, items: { type: 'array', items: ref('Notificacion') } } }) },
          '401': E401,
        },
      },
    },
    '/api/notificaciones/no-leidas': {
      get: { tags: ['Notificaciones'], summary: 'Cantidad sin leer (para la campana)', security: seguro, responses: { '200': { description: '{ no_leidas }' }, '401': E401 } },
    },
    '/api/notificaciones/{id}/leer': {
      post: { tags: ['Notificaciones'], summary: 'Marcar como leída', security: seguro, parameters: [idPath('id de la notificación')], responses: { '204': { description: 'Leída' }, '401': E401, '404': E404() } },
    },
    '/api/notificaciones/leer-todas': {
      post: { tags: ['Notificaciones'], summary: 'Marcar todas como leídas', security: seguro, responses: { '200': { description: '{ marcadas }' }, '401': E401 } },
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
