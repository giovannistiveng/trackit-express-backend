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