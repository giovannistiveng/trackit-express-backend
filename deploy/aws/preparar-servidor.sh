#!/usr/bin/env bash
# Prepara un EC2 nuevo con Ubuntu 24.04 para TrackIt Express (se corre UNA vez):
#   sudo bash preparar-servidor.sh
# Instala Docker, crea 2 GB de memoria de intercambio, deja /opt/trackit listo con los archivos
# de esta carpeta y programa el respaldo diario de la base de datos.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Córrelo con sudo: sudo bash $0" >&2; exit 1; fi
USUARIO="${SUDO_USER:-ubuntu}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
DESTINO=/opt/trackit

echo "==> Actualizando el sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
timedatectl set-timezone America/Bogota

echo "==> Instalando Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "$USUARIO"
systemctl enable --now docker

echo "==> Memoria de intercambio (2 GB) para que la base y Node no se queden sin RAM"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Carpeta de la aplicación: $DESTINO"
mkdir -p "$DESTINO/respaldos"
for f in docker-compose.yml Caddyfile respaldo.sh .env.example; do
  [[ -f "$AQUI/$f" ]] && cp "$AQUI/$f" "$DESTINO/"
done
chmod +x "$DESTINO/respaldo.sh"
if [[ ! -f "$DESTINO/.env" ]]; then
  cp "$DESTINO/.env.example" "$DESTINO/.env"
fi
chmod 600 "$DESTINO/.env"
chown -R "$USUARIO:$USUARIO" "$DESTINO"

echo "==> Respaldo diario de la base de datos a las 3:15 a. m."
cat > /etc/cron.d/trackit-respaldo <<CRON
15 3 * * * $USUARIO $DESTINO/respaldo.sh >> $DESTINO/respaldos/respaldo.log 2>&1
CRON

echo "==> Registros de Docker con tamaño limitado"
if [[ ! -f /etc/docker/daemon.json ]]; then
  printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "3" }\n}\n' > /etc/docker/daemon.json
  systemctl restart docker
fi

echo
echo "Listo. Siguiente paso: completa $DESTINO/.env (ver README) y despliega desde GitHub Actions."
echo "Cierra la sesión SSH y vuelve a entrar para usar docker sin sudo."
