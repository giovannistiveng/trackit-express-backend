#!/usr/bin/env bash
# Respaldo de la base de datos de TrackIt Express (lo programa preparar-servidor.sh cada día).
# Guarda un .sql.gz en /opt/trackit/respaldos y borra los de más de 14 días.
# Si RESPALDO_S3 está en .env (p. ej. s3://mi-bucket/trackit) y el servidor tiene AWS CLI con un rol
# de IAM que permite escribir en ese bucket, también sube la copia a S3.
#
# Restaurar: gunzip -c respaldos/trackit-FECHA.sql.gz | docker compose exec -T db psql -U trackit trackit_express
set -euo pipefail
cd "$(dirname "$0")"
# Solo las variables que hacen falta (el .env puede tener valores con espacios que bash no entiende)
leer() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '"'"'"'\r'; }
DB_USER="$(leer DB_USER)"
DB_NAME="$(leer DB_NAME)"
RESPALDO_S3="$(leer RESPALDO_S3)"

archivo="respaldos/trackit-$(date +%F-%H%M).sql.gz"
docker compose exec -T db pg_dump -U "${DB_USER:-trackit}" "${DB_NAME:-trackit_express}" | gzip > "$archivo"
echo "$(date '+%F %T') respaldo creado: $archivo ($(du -h "$archivo" | cut -f1))"

find respaldos -name 'trackit-*.sql.gz' -mtime +14 -delete

if [[ -n "${RESPALDO_S3:-}" ]] && command -v aws >/dev/null; then
  aws s3 cp "$archivo" "$RESPALDO_S3/" --only-show-errors && echo "subido a $RESPALDO_S3"
fi
