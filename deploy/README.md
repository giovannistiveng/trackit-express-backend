# Despliegue de TrackIt Express

Este documento explica cómo correr la aplicación completa en contenedores y propone un plan para
llevarla a un servidor (primero una máquina virtual Ubuntu en VirtualBox y después la nube).

```
            Navegador / app móvil
                    │  http(s)://servidor
          ┌─────────▼──────────┐
          │  web (Nginx)       │  Angular compilado + proxy /api y /uploads (SSE sin búfer)
          └─────────┬──────────┘
                    │ red interna de Docker
          ┌─────────▼──────────┐
          │  api (Node 22)     │  Express + TypeScript; al iniciar crea/migra la base de datos
          └─────────┬──────────┘
          ┌─────────▼──────────┐
          │  db (PostgreSQL 16)│  datos en el volumen pg-datos
          └────────────────────┘
```

## 1. Correr todo con Docker (cualquier equipo)

Requisitos: Docker Desktop (Windows/macOS) o Docker Engine (Linux) y las dos carpetas del proyecto
una al lado de la otra (`trackit-express-backend` y `trackit-express-frontend`).

```bash
cd trackit-express-backend/deploy
cp .env.example .env        # en Windows: copy .env.example .env
# Edita .env: DB_PASSWORD y JWT_SECRET son obligatorios
docker compose up -d --build
```

- Aplicación: http://localhost:8080 · Swagger: http://localhost:8080/api/docs
- Administrador inicial: `admin@trackit.com.co` / `Admin2026*` (cámbiala al entrar).
- Ver logs: `docker compose logs -f api` · Detener: `docker compose down` (los datos se conservan).
- Borrar también los datos: `docker compose down -v`.
- Actualizar a una versión nueva: `git pull` en los dos repositorios y `docker compose up -d --build`
  (la API aplica sola las migraciones pendientes al iniciar).

Qué hace cada imagen:

| Imagen        | Etapas                                                    | Detalles                                                                                           |
| ------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `trackit-api` | dependencias → compilación TypeScript → ejecución         | usuario sin privilegios, healthcheck `/health`, volumen `/app/datos` (logs, archivos, claves push) |
| `trackit-web` | compilación Angular (producción + service worker) → Nginx | rutas de Angular, caché de archivos con hash, encabezados de seguridad, proxy SSE                  |

Solo para desarrollo existe `docker-compose.yml` en la raíz del backend, que levanta únicamente
PostgreSQL en el puerto 5432 (si ya tienes PostgreSQL instalado en ese puerto, no lo necesitas).

## 2. Plan: servidor propio con VirtualBox + Ubuntu Server (para implementar después)

Objetivo: practicar un despliegue real en una máquina virtual igual a un servidor en la nube.

### 2.1 Crear la máquina virtual

1. Descargar **Ubuntu Server 24.04 LTS** (ISO) y **VirtualBox**.
2. Nueva VM: 2 CPU, **4 GB de RAM** (mínimo 2 GB), disco de 25 GB.
3. Red: **Adaptador puente** (la VM recibe una IP de tu red, p. ej. `192.168.1.50`, y otros equipos
   o celulares de la misma Wi-Fi pueden abrir la app). Alternativa: NAT con reenvío de puertos
   (anfitrión 8080 → invitado 80 y anfitrión 2222 → invitado 22).
4. Instalar Ubuntu marcando **OpenSSH server**. Crear un usuario (p. ej. `trackit`).

### 2.2 Preparar el servidor

```bash
ssh trackit@192.168.1.50
sudo apt update && sudo apt upgrade -y
# Docker oficial
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
# Cortafuegos: solo SSH y web
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
sudo timedatectl set-timezone America/Bogota
```

### 2.3 Instalar la aplicación

```bash
mkdir -p ~/trackit && cd ~/trackit
git clone https://github.com/giovannistiveng/trackit-express-backend.git
git clone https://github.com/giovannistiveng/trackit-express-frontend.git
cd trackit-express-backend/deploy
cp .env.example .env && nano .env
#   WEB_PORT=80
#   PUBLIC_URL=http://192.168.1.50      (o el dominio)
#   DB_PASSWORD=...  JWT_SECRET=...      (y las APIs externas)
docker compose up -d --build
```

### 2.4 Copias de seguridad

```bash
# Base de datos (diario con cron: crontab -e)
docker compose exec -T db pg_dump -U trackit trackit_express | gzip > ~/respaldos/trackit-$(date +%F).sql.gz
# Archivos subidos y claves push
docker run --rm -v trackit_api-datos:/datos -v ~/respaldos:/r alpine tar czf /r/datos-$(date +%F).tgz -C /datos .
```

Restaurar: `gunzip -c respaldo.sql.gz | docker compose exec -T db psql -U trackit trackit_express`.

### 2.5 Paso a la nube

La misma VM se replica en cualquier proveedor (AWS EC2/Lightsail, DigitalOcean, Azure, Google Cloud,
Oracle Cloud Free Tier): Ubuntu 24.04, 2 vCPU / 4 GB, y los pasos 2.2–2.4 sin cambios. Además:

1. **Dominio** (p. ej. `trackit.com.co`) apuntando a la IP pública del servidor (registro A).
2. **HTTPS obligatorio**: la geolocalización, la cámara, la PWA y las notificaciones push solo
   funcionan con HTTPS fuera de `localhost`. Opciones:
   - Caddy delante de `web` (certificados de Let's Encrypt automáticos): servicio extra en el
     compose con `reverse_proxy web:80` y los puertos 80/443.
   - O Certbot + Nginx en el servidor.
3. `PUBLIC_URL=https://trackit.com.co` en `deploy/.env` y volver a `docker compose up -d`.
4. Base de datos administrada opcional (RDS, Neon, Supabase): poner `DATABASE_URL` y `DB_SSL=true`
   y quitar el servicio `db`.
5. Archivos en **Cloudinary** (las fotos no dependen del disco del servidor).
6. Correo real (SMTP), Nequi en modo `conecta` y claves VAPID fijas.
7. Monitoreo: `docker compose ps` (healthchecks), logs en el volumen `api-datos`, y una alerta de
   disponibilidad gratuita (UptimeRobot) contra `https://trackit.com.co/health`.
8. CI/CD (siguiente paso): GitHub Actions que corra pruebas + SonarQube, construya las imágenes,
   las publique en GitHub Container Registry y actualice el servidor por SSH.

## 3. Variables y credenciales de las APIs externas

Todas son opcionales: si están vacías la app funciona en modo de desarrollo.

| Servicio                           | Variables                                                                                                | Dónde se obtienen                                                                                                                                                                              | Sin configurar                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Seguridad                          | `JWT_SECRET` (≥ 32 caracteres)                                                                           | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`                                                                                                               | Obligatoria en producción            |
| Archivos (fotos y documentos)      | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`                                   | cloudinary.com → Dashboard → API Keys                                                                                                                                                          | Se guardan en el disco (volumen)     |
| Correo (verificación y contraseña) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`                           | Gmail: activar verificación en 2 pasos y crear una **contraseña de aplicación** (`smtp.gmail.com`, 587). O Brevo/SendGrid                                                                      | Los correos quedan en `logs/correos` |
| Pagos Nequi                        | `NEQUI_MODO=conecta`, `NEQUI_CLIENT_ID`, `NEQUI_CLIENT_SECRET`, `NEQUI_API_KEY`, `NEQUI_CODIGO_COMERCIO` | Registro de comercio en el portal de negocios de Nequi → validación → credenciales de sandbox y luego de producción                                                                            | Modo simulado (no cobra)             |
| Push en navegador                  | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`                                                 | `npx web-push generate-vapid-keys`                                                                                                                                                             | Se generan y guardan solas           |
| Push en la app Android/iOS         | `FCM_SERVICE_ACCOUNT_FILE`                                                                               | Firebase Console → Configuración del proyecto → Cuentas de servicio → Generar clave privada (JSON). En Docker: guárdalo en `deploy/secretos/firebase.json` y usa `/run/secretos/firebase.json` | Solo push web                        |
| Mapas y direcciones                | `NOMINATIM_CONTACT` (un correo)                                                                          | Política de uso de OpenStreetMap                                                                                                                                                               | Usa el correo por defecto            |
