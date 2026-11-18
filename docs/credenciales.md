# Credenciales de las APIs externas

Todas son opcionales: con el `.env` vacío la app funciona en modo de desarrollo (archivos en disco,
correos en `logs/correos`, Nequi simulado, push solo en el navegador). Llénalas en
`trackit-express-backend/.env` (desarrollo) o en `deploy/.env` (Docker). Nunca subas esos archivos a git.

Después de cambiar el `.env`: reinicia `npm run dev`, o en Docker `docker compose up -d`.

## 1. Seguridad (obligatoria en producción)

```env
JWT_SECRET=
```

Genera un valor aleatorio de 48 bytes y pégalo:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## 2. Fotos y documentos: Cloudinary

```env
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

1. Crea una cuenta gratuita en cloudinary.com.
2. En el panel (Dashboard → API Keys) copia _Cloud name_, _API Key_ y _API Secret_.
3. Sin estas variables las fotos se guardan en el disco del servidor (`uploads/` o el volumen `api-datos`).

## 3. Correo: verificación de cuenta y recuperar contraseña

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu.correo@gmail.com
SMTP_PASS=
MAIL_FROM="TrackIt Express <tu.correo@gmail.com>"
```

Con Gmail:

1. Activa la **verificación en 2 pasos** en tu cuenta de Google (Seguridad).
2. Entra a **Contraseñas de aplicaciones** (myaccount.google.com/apppasswords), crea una llamada
   `TrackIt` y copia los 16 caracteres en `SMTP_PASS` (sin espacios).
3. Gmail permite unos 500 correos al día. Para más volumen usa Brevo o SendGrid (mismas variables,
   con el host y el usuario que te den).

## 4. Notificaciones push en el navegador (VAPID)

```env
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:soporte@trackit.com.co
```

```bash
npm run vapid
```

Copia la _Public Key_ y la _Private Key_. Si las dejas vacías, el backend las genera solo y las guarda
en `.vapid.json` (en Docker, en el volumen). Fíjalas en el `.env` antes de publicar: si cambian, los
usuarios tienen que volver a activar las notificaciones.

## 5. Notificaciones push en la app Android/iOS (Firebase)

```env
FCM_SERVICE_ACCOUNT_FILE=/ruta/a/firebase.json
```

1. Crea un proyecto en console.firebase.google.com y agrega la app Android (el paquete de Capacitor).
2. Configuración del proyecto → **Cuentas de servicio** → **Generar nueva clave privada** (descarga un JSON).
3. Guarda el JSON fuera de git. En Docker: `deploy/secretos/firebase.json` y
   `FCM_SERVICE_ACCOUNT_FILE=/run/secretos/firebase.json`.
4. Solo hace falta si empaquetas la app móvil; la web funciona con VAPID.

## 6. Pagos con Nequi

```env
NEQUI_MODO=conecta
NEQUI_CLIENT_ID=
NEQUI_CLIENT_SECRET=
NEQUI_API_KEY=
NEQUI_CODIGO_COMERCIO=
```

1. Crea una cuenta de desarrollador en el portal **Nequi Conecta** (conecta.nequi.com.co) y registra la
   aplicación: te entregan _client id_, _client secret_ y _API key_ de pruebas (sandbox).
2. Para cobrar de verdad, Nequi valida tu negocio (RUT/NIT o cédula del responsable) y te da las
   credenciales de producción y el código de comercio.
3. Mientras tanto deja `NEQUI_MODO=simulado`: los cobros se aprueban solos a los pocos segundos
   (un celular que termina en 0000 se rechaza y uno en 9999 vence), para probar todo el flujo.

## 7. Mapas y direcciones (OpenStreetMap)

```env
NOMINATIM_CONTACT=soporte@trackit.com.co
```

No requiere cuenta. La política de uso de OpenStreetMap pide identificar la aplicación con un correo de
contacto. Las rutas por calles usan el servidor público de OSRM; con mucho tráfico conviene montar uno
propio o contratar un proveedor (Mapbox, Stadia Maps).

## Lista rápida para producción

| Variable                   | ¿Obligatoria?        | Sin configurar                          |
| -------------------------- | -------------------- | --------------------------------------- |
| `JWT_SECRET`               | Sí                   | La API no arranca en producción         |
| `DB_PASSWORD`              | Sí (Docker)          | Docker no levanta la base               |
| `CLOUDINARY_*`             | Recomendada          | Fotos en el disco del servidor          |
| `SMTP_*`                   | Recomendada          | No llegan correos de verificación       |
| `VAPID_*`                  | Recomendada          | Se generan solas (cambian si se borran) |
| `NEQUI_*`                  | Para cobrar en línea | Nequi simulado                          |
| `FCM_SERVICE_ACCOUNT_FILE` | Solo app móvil       | Solo push en el navegador               |
| `NOMINATIM_CONTACT`        | Recomendada          | Usa un correo genérico                  |
