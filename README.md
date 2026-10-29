# TrackIt Express - Backend

API REST de TrackIt Express: envíos y logística local en Fusagasugá y alrededores
(cotización por zona, PIN de entrega, seguimiento, aprobación de conductores y auditoría).

## Stack

- Node.js 20+, Express 5, TypeScript estricto
- PostgreSQL
- Arquitectura hexagonal: `domain` (entidades y puertos) → `application` (casos de uso) → `infrastructure` (PostgreSQL, HTTP, OpenStreetMap, Cloudinary)
- JWT con autorización por rol, bcrypt, Helmet, límite de peticiones en login y registro
- OpenStreetMap (Nominatim + Haversine) para distancias
- Cloudinary o disco local para documentos y fotos de entrega
- Swagger (OpenAPI 3) en `/api/docs`
- Jest + Supertest, cobertura para SonarQube

## Puesta en marcha

```bash
npm install
cp .env.example .env        # en Windows: copy .env.example .env  → ajusta DB_PASSWORD
npm run db:setup            # base nueva: crea tablas y datos iniciales
npm run db:migrate          # base existente de una versión anterior: aplica las migraciones
npm run dev                 # http://localhost:3000  ·  documentación en /api/docs
```

La base de datos (`DB_NAME`) debe existir antes de `db:setup` (por ejemplo, créala en pgAdmin).

**Administrador inicial:** `admin@trackit.com.co` / `Admin2026*`. Cámbialo después del primer despliegue.

## Scripts

| Script | Qué hace |
|--------|----------|
| `npm run dev` | Servidor con recarga automática |
| `npm run build` | Compila a `dist/` |
| `npm start` | Ejecuta la versión compilada (producción) |
| `npm run typecheck` | Verifica tipos (código y pruebas) |
| `npm test` | Pruebas unitarias y de integración |
| `npm run test:coverage` | Pruebas con cobertura (`coverage/lcov.info` para SonarQube) |
| `npm run db:setup` | Crea el esquema y carga `seed.sql` |
| `npm run db:migrate` | Aplica las migraciones pendientes de `database/migrations` |
| `npm run sonar` | Envía el análisis a SonarQube |

## Variables de entorno

Ver [.env.example](.env.example). Las principales:

| Variable | Uso |
|----------|-----|
| `DATABASE_URL` o `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` | Conexión a PostgreSQL (`DB_SSL=true` si el proveedor lo exige) |
| `JWT_SECRET` | Obligatorio en producción, mínimo 32 caracteres |
| `CORS_ORIGINS` | URL del frontend en producción |
| `PUBLIC_URL` | URL pública del backend (enlaces a archivos en disco) |
| `CLOUDINARY_*` | Si están vacías, los archivos se guardan en `UPLOADS_DIR` y se sirven en `/uploads` |
| `LOG_*` | Logs en `logs/` (ver abajo) |

## API

Documentación interactiva: **http://localhost:3000/api/docs** (JSON en `/api/docs.json`).
Inicia sesión en `POST /api/auth/login`, copia el token y pulsa **Authorize**.

| Método y ruta | Rol | Caso de uso |
|---------------|-----|-------------|
| `POST /api/auth/register` | Público | CU-001 (Cliente o Conductor; el conductor nace con perfil Pendiente) |
| `POST /api/auth/login` | Público | CU-002 |
| `GET /api/zonas` | Autenticado | Zonas de tarifa |
| `POST /api/cotizar/cotizar` | Cliente | CU-005 |
| `POST /api/envios/crear` | Cliente | CU-006 |
| `GET /api/clientes/envios?estado=activos\|historial` | Cliente | E6-HU2 |
| `GET /api/envios/:id` | Dueño, conductor asignado, admin | CU-008 (el PIN solo para el dueño) |
| `POST /api/envios/:id/calificar` | Cliente dueño | CU-010 |
| `GET /api/conductores/me` | Conductor | Perfil, aprobación y vehículo |
| `POST /api/vehicles/register` | Conductor | CU-003 |
| `POST /api/documentos/upload` | Conductor | CU-004 |
| `GET /api/conductores/envios/disponibles` | Conductor aprobado | CU-007 |
| `GET /api/conductores/envios/activo` | Conductor | Servicio en curso |
| `POST /api/envios/aceptar` | Conductor aprobado | CU-007 (un servicio activo a la vez) |
| `POST /api/envios/:id/iniciar-ruta` | Conductor asignado | Asignado → En Ruta |
| `POST/GET /api/envios/:id/ubicacion` | Conductor asignado / dueño | CU-008 |
| `POST /api/envios/:id/evidencia` | Conductor asignado | Foto de entrega |
| `POST /api/envios/:id/validar-entrega` | Conductor asignado | CU-009 |
| `GET /api/conductores/pendientes` | Administrador | CU-011 |
| `POST /api/conductores/aprobar` | Administrador | CU-011 (motivo obligatorio al rechazar) |
| `GET /api/admin/dashboard/metrics` | Administrador | E7-HU2 |
| `GET /api/admin/auditoria` | Administrador | E7-HU2 |
| `POST /api/logs/frontend` | Público | Logs del frontend |
| `GET /health` | Público | Estado del servidor y la base de datos |

Errores: `{ "error": "mensaje", "statusCode": 400 }`. Toda respuesta trae `X-Request-Id`.

## Base de datos

- `database/schema.sql`: esquema completo (bases nuevas).
- `database/seed.sql`: roles, zonas y administrador (idempotente).
- `database/migrations/`: cambios para bases existentes; `npm run db:migrate` lleva el registro en `schema_migrations`.

## Logs

En `logs/` (no se suben a git):

| Archivo | Contenido |
|---------|-----------|
| `trackit-AAAA-MM-DD.txt` | Todo: arranque, cada petición (método, ruta, código, duración, id), errores con stack |
| `errores-AAAA-MM-DD.txt` | Solo advertencias y errores |
| `frontend-AAAA-MM-DD.txt` | Eventos enviados por el frontend |

Contraseñas, PIN y tokens se guardan como `[OCULTO]`. Los archivos rotan cada día y se borran tras `LOG_RETENTION_DAYS`.

## Pruebas

```bash
npm test
```

- **Unitarias:** casos de uso con repositorios en memoria, middlewares, seguridad y adaptadores externos simulados.
- **Integración:** la API completa con Supertest contra PostgreSQL. Usan la base `TEST_DB_NAME` (por defecto `trackit_test`), que **se borra y recrea**; créala vacía una vez. Por seguridad, solo borran bases cuyo nombre contiene "test". Sin PostgreSQL disponible, se omiten con un aviso.

## Calidad con SonarQube

1. Levanta SonarQube (Docker): `docker run -d --name sonarqube -p 9000:9000 sonarqube:community`
2. Entra a http://localhost:9000 (admin/admin), crea el proyecto `trackit-express-backend` y genera un token.
3. Ejecuta:
   ```bash
   npm run test:coverage
   npm run sonar -- -Dsonar.host.url=http://localhost:9000 -Dsonar.token=TU_TOKEN
   ```
   El escáner (`sonarqube-scanner` 5) necesita Node.js 22.12 o superior y descarga el motor de análisis la primera vez.

## Despliegue

1. Crea la base PostgreSQL y define `DATABASE_URL` (y `DB_SSL=true` si aplica).
2. Define `NODE_ENV=production`, `JWT_SECRET`, `CORS_ORIGINS` y `PUBLIC_URL`; configura Cloudinary si el disco del servidor no es persistente.
3. `npm ci && npm run build && npm run db:setup` (o `db:migrate` si la base ya existía).
4. Comando de inicio: `npm start`. Verificación: `GET /health`.

## Ramas

- `main`: producción estable
- `pre-produccion`: staging
- `desarrollo`: trabajo diario
