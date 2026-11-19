# Despliegue en AWS (EC2 + Docker + HTTPS)

```
 Usuario ──https──▶ Caddy (certificado Let's Encrypt) ──▶ web (Nginx + Angular) ──▶ api (Node) ──▶ db (PostgreSQL)
                    └──────────────── un servidor EC2 con Docker, en /opt/trackit ────────────────┘
 GitHub Actions: CI en verde en main → publica las imágenes en ghcr.io → entra por SSH y actualiza
```

| Archivo | Qué es |
| --- | --- |
| `docker-compose.yml` | Los 4 contenedores; las imágenes de la API y la web vienen de `ghcr.io`. |
| `Caddyfile` | HTTPS automático y reenvío a la web (con soporte para eventos en tiempo real). |
| `.env.example` | Variables del servidor (`/opt/trackit/.env`). |
| `preparar-servidor.sh` | Se corre una vez: Docker, memoria de intercambio, `/opt/trackit` y respaldo diario. |
| `respaldo.sh` | Copia de la base de datos (cada día a las 3:15 a. m., guarda 14 días; opcional a S3). |
| `.github/workflows/deploy.yml` | En los dos repositorios: publica la imagen y actualiza el servidor. |

Costo aproximado: una instancia **t3.small** (2 GB) con 20 GB de disco y una IP elástica cuesta unos
USD 18 al mes, que salen de los créditos de la cuenta nueva. Una **t3.micro** (1 GB) también funciona
gracias a la memoria de intercambio y cuesta cerca de la mitad.

## 1. Cuenta y alerta de gastos (una vez)

1. Crea la cuenta en [aws.amazon.com](https://aws.amazon.com) (plan **Free**: usa créditos y no cobra
   a la tarjeta).
2. Arriba a la derecha elige la región **us-east-1 (N. Virginia)**: es la más barata y tiene buena
   latencia hacia Colombia. Usa siempre la misma.
3. **Billing and Cost Management → Budgets → Create budget → Zero spend budget** (o uno mensual de
   USD 20) con tu correo: te avisa si algo empieza a cobrar.

## 2. Crear el servidor (EC2)

**EC2 → Instances → Launch instances**:

| Campo | Valor |
| --- | --- |
| Name | `trackit-produccion` |
| AMI | **Ubuntu Server 24.04 LTS** (64-bit x86) |
| Instance type | **t3.small** (o t3.micro) |
| Key pair | **Create new key pair** → nombre `trackit`, tipo RSA, formato **.pem** → se descarga `trackit.pem`. Guárdalo bien: es la única llave del servidor. |
| Network settings → Edit | Security group nuevo `trackit-web` con 3 reglas de entrada: **SSH 22** desde *Anywhere* (GitHub Actions entra por aquí; el servidor solo acepta la llave .pem), **HTTP 80** y **HTTPS 443** desde *Anywhere*. |
| Storage | **20 GiB gp3** |

Luego **Launch instance**.

**IP fija:** EC2 → **Elastic IPs → Allocate Elastic IP address → Allocate**; selecciónala →
**Actions → Associate Elastic IP address** → tu instancia → **Associate**. Anota la IP (ej. `3.90.12.34`).

**Tu dominio:** sin dominio propio usa la IP con guiones + `.sslip.io` → `3-90-12-34.sslip.io`
(apunta solo a tu IP y Let's Encrypt le da certificado). Con dominio propio, crea un registro **A**
hacia la IP elástica y usa ese nombre.

## 3. Entrar al servidor y prepararlo (desde PowerShell en Windows)

```powershell
# La llave solo debe poder leerla tu usuario (si no, SSH la rechaza)
icacls "$HOME\Downloads\trackit.pem" /inheritance:r /grant:r "$($env:USERNAME):(R)"

# Copia la carpeta de despliegue al servidor (cambia la IP)
cd "C:\Proyecto Track It\trackit-express-backend\deploy"
scp -i "$HOME\Downloads\trackit.pem" -r aws ubuntu@3.90.12.34:/tmp/

# Entra al servidor
ssh -i "$HOME\Downloads\trackit.pem" ubuntu@3.90.12.34
```

Ya dentro del servidor (Ubuntu):

```bash
sudo bash /tmp/aws/preparar-servidor.sh
exit
```

## 4. Configurar `/opt/trackit/.env`

La forma fácil es partir de tu `deploy/.env` (ya tiene las claves de producción) y agregar las
variables de AWS. Desde PowerShell:

```powershell
cd "C:\Proyecto Track It\trackit-express-backend\deploy"
scp -i "$HOME\Downloads\trackit.pem" .env ubuntu@3.90.12.34:/opt/trackit/.env
ssh -i "$HOME\Downloads\trackit.pem" ubuntu@3.90.12.34
```

En el servidor:

```bash
cd /opt/trackit
cat >> .env <<'FIN'
DOMINIO=3-90-12-34.sslip.io
CORREO_ADMIN=tu-correo@gmail.com
GHCR_OWNER=giovannistiveng
FIN
chmod 600 .env
exit
```

(`WEB_PORT` y `PUBLIC_URL` de `deploy/.env` se ignoran aquí: la URL sale de `DOMINIO`.)

## 5. Conectar GitHub con el servidor (en los DOS repositorios)

En GitHub, en `trackit-express-backend` y también en `trackit-express-frontend`:
**Settings → Secrets and variables → Actions**

- Pestaña **Variables → New repository variable**: `EC2_HOST` = la IP elástica (ej. `3.90.12.34`).
- Pestaña **Secrets → New repository secret**: `EC2_LLAVE_SSH` = todo el contenido de `trackit.pem`
  (ábrelo con el Bloc de notas y copia desde `-----BEGIN` hasta `-----END ...-----`).

## 6. Primer despliegue

1. Sube los cambios a `main` en los dos repositorios (por ejemplo, un pull request de `desarrollo`
   a `main`). Cuando el CI pase, cada repositorio despliega solo.
2. O a mano, en este orden: **backend** → Actions → *Desplegar backend* → **Run workflow**; cuando
   termine, **frontend** → Actions → *Desplegar frontend* → **Run workflow**.
3. Abre `https://3-90-12-34.sslip.io`. La primera vez el certificado tarda unos segundos.
4. Entra con `admin@trackit.com.co` / `Admin2026*` y **cambia la contraseña de inmediato**.
5. Revisa: `https://TU-DOMINIO/health` responde `"status":"ok"`, el registro envía el correo de
   verificación y la subida de documentos llega a Cloudinary.

Desde ahí, cada vez que el CI de `main` pase, el repositorio correspondiente se despliega solo.

## Operación del día a día

Entra con `ssh -i "$HOME\Downloads\trackit.pem" ubuntu@TU-IP` y `cd /opt/trackit`:

| Para | Comando |
| --- | --- |
| Ver el estado | `docker compose ps` |
| Ver los registros | `docker compose logs -f api` (o `web`, `caddy`, `db`) |
| Reiniciar | `docker compose restart api` |
| Respaldo ahora | `./respaldo.sh` (quedan en `respaldos/`) |
| Restaurar un respaldo | `gunzip -c respaldos/trackit-FECHA.sql.gz \| docker compose exec -T db psql -U trackit trackit_express` |
| Volver a una versión anterior | en `.env` pon `VERSION_API=<sha corto>` o `VERSION_WEB=<sha corto>` y `docker compose up -d` |
| Cambiar una variable | edita `.env` y `docker compose up -d` |

**Ahorrar créditos:** si no vas a usar la app unos días, **EC2 → Instance state → Stop**. Los datos se
conservan. La IP elástica cobra un poco aunque la instancia esté apagada; si la vas a dejar parada
mucho tiempo, libérala (y luego usa la nueva IP en `DOMINIO` y en `EC2_HOST`).

**Respaldos en S3 (opcional):** crea un bucket, un rol de IAM para EC2 con permiso `s3:PutObject` en
ese bucket, asígnalo a la instancia (Actions → Security → Modify IAM role), instala la CLI
(`sudo snap install aws-cli --classic`) y agrega `RESPALDO_S3=s3://tu-bucket/trackit` al `.env`.

## Si algo falla

- **El despliegue no se conecta por SSH:** revisa `EC2_HOST`, que el secreto tenga la llave
  completa y que el security group permita el puerto 22.
- **`denied` al descargar la imagen:** el flujo usa el token del propio repositorio; despliega cada
  imagen desde su repositorio (la API desde el backend y la web desde el frontend).
- **El navegador avisa de certificado inválido:** espera un minuto y recarga; si sigue, mira
  `docker compose logs caddy` (los puertos 80 y 443 deben estar abiertos y `DOMINIO` debe apuntar a la IP).
- **La API no arranca:** `docker compose logs api` (lo más común: una variable obligatoria vacía en `.env`).
