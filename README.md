# TrackIt Express - Backend

API REST de TrackIt Express: envíos y logística local en Fusagasugá y alrededores
(cotización por zona, PIN de entrega, seguimiento en el mapa con tiempo estimado de llegada,
cancelaciones, notificaciones, ganancias del conductor, aprobación de conductores y auditoría).

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

| Script                  | Qué hace                                                    |
| ----------------------- | ----------------------------------------------------------- |
| `npm run dev`           | Servidor con recarga automática                             |
| `npm run build`         | Compila a `dist/`                                           |
| `npm start`             | Ejecuta la versión compilada (producción)                   |
| `npm run typecheck`     | Verifica tipos (código y pruebas)                           |
| `npm test`              | Pruebas unitarias y de integración                          |
| `npm run test:coverage` | Pruebas con cobertura (`coverage/lcov.info` para SonarQube) |
| `npm run db:setup`      | Crea el esquema y carga `seed.sql`                          |
| `npm run db:migrate`    | Aplica las migraciones pendientes de `database/migrations`  |
| `npm run sonar`         | Envía el análisis a SonarQube                               |

## Variables de entorno

Ver [.env.example](.env.example). Las principales:

| Variable                                                     | Uso                                                                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` o `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` | Conexión a PostgreSQL (`DB_SSL=true` si el proveedor lo exige)                                              |
| `JWT_SECRET`                                                 | Obligatorio en producción, mínimo 32 caracteres                                                             |
| `CORS_ORIGINS`                                               | URL del frontend en producción                                                                              |
| `PUBLIC_URL`                                                 | URL pública del backend (enlaces a archivos en disco)                                                       |
| `CLOUDINARY_*`                                               | Si están vacías, los archivos se guardan en `UPLOADS_DIR` y se sirven en `/uploads`                         |
| `NOMINATIM_CONTACT`                                          | Correo que OpenStreetMap exige para consultar direcciones (no hace falta API key)                           |
| `LOG_*`                                                      | Logs en `logs/` (ver abajo)                                                                                 |
| `FRONTEND_URL`                                               | Base de los enlaces de los correos (verificar, restablecer contraseña)                                      |
| `SMTP_*`, `MAIL_FROM`                                        | Envío de correos. Vacías: los correos se guardan en `logs/correos/` y el enlace sale en el log              |
| `NEQUI_MODO`                                                 | `simulado` (por defecto, para desarrollo) o `conecta` (Nequi real con `NEQUI_CLIENT_ID`/`SECRET`/`API_KEY`) |
| `VAPID_*`                                                    | Web Push. Vacías: se generan solas y se guardan en `.vapid.json`                                            |
| `FCM_SERVICE_ACCOUNT_FILE`                                   | Cuenta de servicio de Firebase para push en la app Android/iOS (Capacitor)                                  |

## API

Documentación interactiva: **http://localhost:3000/api/docs** (JSON en `/api/docs.json`).
Inicia sesión en `POST /api/auth/login`, copia el token y pulsa **Authorize**.

| Método y ruta                                                                              | Rol                                            | Caso de uso                                                                        |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `POST /api/auth/register`                                                                  | Público                                        | CU-001 (Cliente o Conductor; el conductor nace con perfil Pendiente)               |
| `POST /api/auth/login`                                                                     | Público                                        | CU-002                                                                             |
| `GET /api/zonas`                                                                           | Autenticado                                    | Zonas de cobertura activas (centro, radio y recargo)                               |
| `GET /api/geo/buscar?q=`, `GET /api/geo/inversa?lat=&lon=`                                 | Autenticado                                    | Autocompletar direcciones de la región y dirección de un punto del mapa            |
| `POST /api/cotizar/cotizar`                                                                | Cliente                                        | CU-005 (precio con desglose y precio de cada vehículo)                             |
| `POST /api/envios/crear`                                                                   | Cliente                                        | CU-006                                                                             |
| `GET /api/clientes/envios?estado=activos\|historial`                                       | Cliente                                        | E6-HU2                                                                             |
| `GET /api/envios/:id`                                                                      | Dueño, conductor asignado, admin               | CU-008 (el PIN solo para el dueño)                                                 |
| `POST /api/envios/:id/calificar`                                                           | Cliente dueño                                  | CU-010 (1 a 5 estrellas y comentario opcional)                                     |
| `POST /api/envios/:id/cancelar`                                                            | Cliente dueño (Pendiente) o admin (con motivo) | Cancelación con aviso a la otra parte                                              |
| `GET /api/envios/:id/seguimiento`                                                          | Dueño, conductor asignado, admin               | Mapa: recorrido, señal en vivo, distancia y ETA                                    |
| `GET /api/conductores/me`                                                                  | Conductor                                      | Perfil, aprobación y vehículo                                                      |
| `POST /api/vehicles/register`                                                              | Conductor                                      | CU-003                                                                             |
| `POST /api/documentos/upload`                                                              | Conductor                                      | CU-004                                                                             |
| `GET /api/conductores/envios/disponibles`                                                  | Conductor aprobado                             | CU-007                                                                             |
| `GET /api/conductores/envios/activo`                                                       | Conductor                                      | Servicio en curso                                                                  |
| `GET /api/conductores/envios/historial`                                                    | Conductor                                      | Servicios terminados con calificación y comentario                                 |
| `GET /api/conductores/me/resumen`                                                          | Conductor                                      | Servicios, ganancias (80 % de la tarifa) y reputación                              |
| `POST /api/envios/aceptar`                                                                 | Conductor aprobado                             | CU-007 (un servicio activo a la vez)                                               |
| `POST /api/envios/:id/iniciar-ruta`                                                        | Conductor asignado                             | Asignado → En Ruta                                                                 |
| `POST/GET /api/envios/:id/ubicacion`                                                       | Conductor asignado / dueño                     | CU-008                                                                             |
| `POST /api/envios/:id/evidencia`                                                           | Conductor asignado                             | Foto de entrega                                                                    |
| `POST /api/envios/:id/validar-entrega`                                                     | Conductor asignado                             | CU-009                                                                             |
| `GET /api/conductores/pendientes`                                                          | Administrador                                  | CU-011                                                                             |
| `POST /api/conductores/aprobar`                                                            | Administrador                                  | CU-011 (motivo obligatorio al rechazar)                                            |
| `GET /api/admin/dashboard/metrics`                                                         | Administrador                                  | E7-HU2                                                                             |
| `GET /api/admin/auditoria`                                                                 | Administrador                                  | E7-HU2                                                                             |
| `GET /api/admin/envios`                                                                    | Administrador                                  | Todos los envíos con filtros (estado, zona, texto)                                 |
| `GET/POST /api/admin/zonas`, `PUT /api/admin/zonas/:id`                                    | Administrador                                  | Listar, crear y editar zonas (centro, radio, recargo, activa)                      |
| `PUT /api/admin/tarifas/:categoria`                                                        | Administrador                                  | Banderazo, valor por km, por minuto y mínimo de un vehículo                        |
| `GET /api/admin/contactos`, `POST /api/admin/contactos/:id/atender`                        | Administrador                                  | Mensajes del sitio web                                                             |
| `GET/PATCH /api/usuarios/me`, `POST /api/usuarios/me/password`                             | Autenticado                                    | Perfil, teléfono y contraseña                                                      |
| `GET /api/notificaciones`, `GET /api/notificaciones/no-leidas`                             | Autenticado                                    | Avisos (envío aceptado, en camino, entregado, cancelado, aprobación, calificación) |
| `POST /api/notificaciones/:id/leer`, `POST /api/notificaciones/leer-todas`                 | Autenticado                                    | Marcar como leídas                                                                 |
| `GET /api/publico/estadisticas`, `GET /api/publico/zonas`, `GET /api/publico/tarifas`      | Público                                        | Cifras, zonas y tarifas para el sitio web                                          |
| `POST /api/contacto`                                                                       | Público                                        | Formulario de contacto (5 por minuto por IP)                                       |
| `POST /api/auth/olvide-password`, `POST /api/auth/restablecer-password`                    | Público                                        | Recuperar la contraseña con un enlace por correo (vence en 1 h, un solo uso)       |
| `POST /api/auth/verificar-correo`, `POST /api/usuarios/me/verificacion`                    | Público / Autenticado                          | Verificar el correo (enlace de 48 h) y reenviarlo                                  |
| `PATCH /api/envios/:id`                                                                    | Cliente dueño                                  | Editar tipo de carga, notas y quién recibe mientras está Pendiente                 |
| `GET /api/publico/seguimiento/:token`                                                      | Público                                        | Enlace para quien recibe (WhatsApp), sin PIN ni precio                             |
| `GET /api/envios/:id/pago`, `POST /api/envios/:id/pago/reintentar`, `.../pago/efectivo`    | Cliente dueño                                  | Estado del cobro Nequi, reenviarlo o pasar a efectivo                              |
| `POST /api/envios/:id/recogida`                                                            | Conductor asignado                             | Foto del paquete al recogerlo (Asignado → En Ruta)                                 |
| `POST /api/envios/:id/paradas/:idParada/completar`, `POST /api/envios/:id/llegada-destino` | Conductor asignado                             | Paradas intermedias e ida y vuelta                                                 |
| `GET/POST /api/envios/:id/mensajes`                                                        | Cliente dueño y conductor asignado             | Chat del servicio (admin solo lee)                                                 |
| `GET /api/conductores/me/billetera`                                                        | Conductor                                      | Lo pendiente por liquidar y las liquidaciones                                      |
| `GET /api/admin/pagos`, `POST /api/admin/pagos/:idEnvio/reembolso`                         | Administrador                                  | Cobros y devoluciones                                                              |
| `GET /api/admin/liquidaciones`, `POST .../generar`, `POST .../:id/pagar`                   | Administrador                                  | Liquidación semanal a conductores                                                  |
| `DELETE /api/admin/zonas/:id`, `DELETE /api/admin/contactos/:id`                           | Administrador                                  | Eliminar zonas (se archivan si tienen historial) y mensajes                        |
| `DELETE /api/notificaciones/:id`, `DELETE /api/notificaciones`                             | Autenticado                                    | Borrar un aviso o los ya leídos                                                    |
| `POST /api/eventos/ticket`, `GET /api/eventos?ticket=`                                     | Autenticado                                    | Canal de eventos en tiempo real (SSE)                                              |
| `GET /api/push/clave-publica`, `POST/DELETE /api/push/suscripciones`                       | Autenticado                                    | Notificaciones push (navegador y app móvil)                                        |
| `POST /api/logs/frontend`                                                                  | Público                                        | Logs del frontend                                                                  |
| `GET /health`                                                                              | Público                                        | Estado del servidor y la base de datos                                             |

Errores: `{ "error": "mensaje", "statusCode": 400 }`. Toda respuesta trae `X-Request-Id`.

## Reglas de negocio principales

- **Estados:** Pendiente → Asignado → En Ruta → Entregado. Cualquiera sin terminar puede pasar a **Cancelado**.
- **Cancelación:** el cliente solo mientras está Pendiente; el administrador hasta En Ruta, con motivo obligatorio.
- **Tarifa automática:** banderazo + km × valor_km + minutos × valor_minuto del vehículo, nunca menos de su mínimo;
  más el recargo de la zona (el mayor entre origen y destino) y 20 % nocturno de 8:00 p. m. a 5:59 a. m.
  Se redondea hacia arriba a múltiplos de $100. Valores iniciales (editables por el administrador):

  | Vehículo     | Banderazo | Por km | Por minuto | Mínimo |
  | ------------ | --------- | ------ | ---------- | ------ |
  | Moto Express | 2.000     | 700    | 50         | 4.500  |
  | Motocarro    | 4.000     | 950    | 80         | 8.000  |
  | Camioneta    | 10.000    | 1.600  | 120        | 18.000 |

  Ejemplos en moto: dentro del centro ≈ $4.500; Fusagasugá → Silvania (≈14 km) ≈ $15.000.
  El conductor gana el 80 %; la plataforma, el 20 %.

- **Zonas:** círculos en el mapa (centro + radio). Un punto pertenece a la zona más pequeña que lo contiene; fuera de
  todas, no hay servicio. Distancia y tiempo por carretera con OSRM; direcciones con Nominatim, limitadas a 80 km de
  Fusagasugá (antes "Vereda Pekín" podía caer en otro país y dar miles de km).
- **Un servicio activo por conductor.** Un vehículo más grande atiende pedidos de su tamaño o menores
  (Camioneta ⊃ Motocarro ⊃ Moto Express). Al crear un envío se avisa a los conductores disponibles que pueden llevarlo.
- **PIN:** solo lo ve el cliente dueño; sin el PIN correcto y la foto no se valida la entrega.
- **Seguimiento:** la señal está "en vivo" si la última posición tiene menos de 2 minutos. El ETA usa 30 km/h y un factor de 1,3 por las curvas de la vía.
- **Pagos:**
  - _Efectivo contra entrega:_ el envío se publica al crearlo; el conductor confirma "recibí el efectivo" al entregar.
  - _Nequi:_ al crear se envía un cobro al celular del cliente (vigencia 10 min). El envío se publica a los conductores
    solo cuando el pago queda aprobado; el cliente puede reintentar (máx. 5) o pasar a efectivo. Si cancela un envío
    pagado, se devuelve el dinero automáticamente (si Nequi falla, queda en `reembolso_pendiente` para el administrador).
  - Un trabajo revisa cada 15 s los cobros pendientes; en modo `simulado` se aprueban a los `NEQUI_SIMULADO_SEGUNDOS`.
    Para probar: celular terminado en `0000` → rechazado; en `9999` → vence; `3000000000` → Nequi no responde.
- **Liquidación semanal (lunes a domingo, hora Colombia):** saldo = 80 % de los servicios pagados con Nequi − 20 % de
  comisión de los cobrados en efectivo. Positivo: la plataforma transfiere al conductor; negativo: el conductor paga la
  comisión. Se generan solas cada lunes (o desde Administración › Pagos) y se marcan pagadas con la referencia.
- **Programados:** de 30 minutos a 7 días; se publican a los conductores 1 hora antes. Recargo nocturno según la hora programada.
- **Paradas e ida y vuelta:** hasta 3 paradas ubicadas en el mapa ($1.500 c/u); la distancia suma cada tramo. En ida
  y vuelta el conductor marca la llegada al destino y la entrega (PIN) se valida al regresar al origen.
- **Recogida:** el conductor debe tomar la foto del paquete al recogerlo; con eso inicia la ruta y el cliente la ve.
- **Chat:** abierto mientras el envío está Asignado o En Ruta; 500 caracteres por mensaje.
- **Tiempo real:** los avisos, mensajes y cambios llegan por SSE (`/api/eventos`) y como notificación push al
  navegador (Web Push, PWA) o a la app Android/iOS (Firebase), así funciona igual al empaquetar la app con Capacitor.

## Base de datos

- `database/schema.sql`: esquema completo (bases nuevas).
- `database/seed.sql`: roles, zonas y administrador (idempotente).
- `database/migrations/`: cambios para bases existentes; `npm run db:migrate` lleva el registro en `schema_migrations`.
  La `003_tarifas_y_zonas.sql` ubica las zonas en el mapa, crea `Tarifa_Vehiculo` y convierte la tarifa base en un
  recargo pequeño (solo si conserva el valor original del seed). La `004_plataforma_completa.sql` agrega pagos,
  liquidaciones, chat, paradas, suscripciones push, tokens de correo y seguimiento público (los usuarios existentes
  quedan con el correo verificado).

## Logs

En `logs/` (no se suben a git):

| Archivo                   | Contenido                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `trackit-AAAA-MM-DD.txt`  | Todo: arranque, cada petición (método, ruta, código, duración, id), errores con stack |
| `errores-AAAA-MM-DD.txt`  | Solo advertencias y errores                                                           |
| `frontend-AAAA-MM-DD.txt` | Eventos enviados por el frontend                                                      |

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
