#!/bin/sh
# Prepara la base de datos (la crea si está vacía o aplica las migraciones pendientes)
# y luego arranca el proceso indicado (por defecto, el servidor de la API).
set -e

if [ "${DB_PREPARAR_AL_INICIAR:-true}" = "true" ]; then
  intento=1
  until node dist/infrastructure/database/cli.js preparar; do
    if [ "$intento" -ge 10 ]; then
      echo "No se pudo preparar la base de datos después de $intento intentos." >&2
      exit 1
    fi
    echo "La base de datos aún no responde; reintento $intento de 10 en 3 s…" >&2
    intento=$((intento + 1))
    sleep 3
  done
fi

# exec: el proceso de Node recibe directamente SIGTERM (apagado limpio con docker stop)
exec "$@"
