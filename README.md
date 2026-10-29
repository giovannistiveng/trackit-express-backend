# TrackIt Express - Backend

Backend de TrackIt Express, plataforma web de conexión y trazabilidad para envíos y logística local en Fusagasugá y alrededores.

## Stack tecnológico

- Node.js + Express (v5.2.1)
- TypeScript
- Arquitectura Hexagonal (Ports & Adapters)
- PostgreSQL (base de datos relacional)
- JWT + Bcrypt (autenticación y seguridad)
- Google Maps API (cálculo de distancias y geolocalización)
- Cloudinary API (almacenamiento de documentos y evidencias)
- Twilio API (envío de SMS con PIN de validación)

## Estructura del proyecto

```
backend/
├── database/           # Scripts SQL (schema.sql, seed.sql)
├── src/
│   ├── config/         # Configuración (variables de entorno, DB)
│   ├── domain/         # Entidades, puertos, servicios de dominio
│   ├── application/    # Casos de uso (use cases) por RF
│   ├── infrastructure/ # Adaptadores: repositorios, APIs externas, Express server
│   └── shared/         # Tipos, errores, utilidades
└── tests/              # Pruebas unitarias e integración
```

## Ramas

- `main` — Producción estable
- `pre-produccion` — Staging, listo para pruebas finales
- `desarrollo` — Rama de trabajo diario

## Requerimientos funcionales implementados

RF1 Registro de usuario · RF2 Inicio de sesión · RF3 Registro de vehículo ·
RF4 Carga de documentos · RF5 Cotización de tarifa · RF6 Solicitud de envío ·
RF7 Asignación de servicio · RF8 Trazabilidad en tiempo real · RF9 Validación de entrega ·
RF10 Calificación del servicio · RF11 Gestión de aprobación de conductores

## Despliegue

Backend desplegado en Render / Railway.

## Logs

El backend registra su actividad en archivos de texto dentro de la carpeta `logs/` (se crea sola y está en `.gitignore`):

| Archivo | Contenido |
|---|---|
| `logs/trackit-AAAA-MM-DD.txt` | Todo lo del día: arranque, cada petición HTTP (método, ruta, código, duración, IP, id), consultas a OpenStreetMap y errores |
| `logs/errores-AAAA-MM-DD.txt` | Solo `WARN` y `ERROR`, para revisar fallas rápido |
| `logs/frontend-AAAA-MM-DD.txt` | Eventos que envía el frontend a `POST /api/logs/frontend` (errores de pantalla, fallos HTTP, acciones clave) |

Formato de cada línea:

```
[2026-10-29 04:04:09.161] [WARN ] [Trazabilidad] GET /api/envios/99 id=48c6b782 → 404 No existe el envío con id 99
```

- Los errores 500 incluyen el stack completo en las líneas siguientes.
- Cada respuesta trae la cabecera `X-Request-Id`; con ese id se encuentra la petición en el log.
- Contraseñas, PIN de seguridad, tokens y secretos se guardan como `[OCULTO]`.
- Los archivos rotan cada día y se borran los que tengan más de `LOG_RETENTION_DAYS` días.

Variables de entorno (opcionales):

| Variable | Por defecto | Uso |
|---|---|---|
| `LOG_DIR` | `logs` | Carpeta de los archivos |
| `LOG_LEVEL` | `DEBUG` en desarrollo, `INFO` en producción | Nivel mínimo: `DEBUG`, `INFO`, `WARN` o `ERROR`. En `DEBUG` también se guarda el cuerpo de cada petición |
| `LOG_RETENTION_DAYS` | `30` | Días que se conservan los archivos (`0` = no borrar) |
| `LOG_TO_CONSOLE` | `true` | Mostrar también los logs en la terminal |

Para usar el logger en código nuevo:

```ts
import { logger } from '../../shared/logger';
const log = logger.child('MiModulo');
log.info('Algo pasó', { id_envio: 5 });
log.error('Algo falló', error);
```

### Logs del frontend

El navegador no puede escribir archivos, así que el frontend envía sus eventos por lotes:

```
POST /api/logs/frontend
{ "eventos": [ { "nivel": "ERROR", "mensaje": "...", "contexto": "Cotizacion",
                 "fecha": "2026-10-29T11:30:00.000Z", "url": "/cliente/nuevo-envio",
                 "sesion": "a1b2c3", "usuario": 1, "meta": { } } ] }
→ 202 { "recibidos": 1, "descartados": 0 }
```

- `nivel` (`DEBUG`, `INFO`, `WARN`, `ERROR`) y `mensaje` (máx. 2.000 caracteres) son obligatorios; el resto es opcional.
- Máximo 50 eventos por lote y 30 lotes por minuto por IP (si se supera, responde 429).
- Los eventos inválidos se descartan sin rechazar el lote. Se quitan los saltos de línea del mensaje para que no se puedan falsificar líneas del log.
- El servidor agrega la IP y el navegador (`User-Agent`), y oculta los mismos datos sensibles que en el resto de logs.
