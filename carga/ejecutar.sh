#!/usr/bin/env bash
# Ejecuta un plan de JMeter en modo consola y genera el reporte HTML.
#
#   carga/ejecutar.sh                       # prueba de carga contra localhost:3000
#   carga/ejecutar.sh estres                # prueba de estrés por escalones
#   HOST=192.168.56.10 carga/ejecutar.sh carga -Jusuarios=100 -Jduracion=600
#
# Requiere JMeter 5.6+ en el PATH o la variable JMETER_HOME.
set -euo pipefail

PLAN="${1:-carga}"
shift || true
case "$PLAN" in carga | estres) ;; *) echo "Plan desconocido: $PLAN (usa carga o estres)" >&2; exit 1 ;; esac

JMETER="${JMETER_HOME:+$JMETER_HOME/bin/}jmeter"
command -v "$JMETER" >/dev/null || { echo "No encuentro JMeter. Agrégalo al PATH o define JMETER_HOME." >&2; exit 1; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
SALIDA="$AQUI/resultados/$PLAN-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$SALIDA"

echo "Ejecutando $PLAN contra ${PROTOCOLO:-http}://${HOST:-localhost}:${PUERTO:-3000} ..."
"$JMETER" -n -t "$AQUI/jmeter/$PLAN.jmx" \
  -l "$SALIDA/resultados.jtl" -j "$SALIDA/jmeter.log" -e -o "$SALIDA/reporte" \
  -Jhost="${HOST:-localhost}" -Jpuerto="${PUERTO:-3000}" -Jprotocolo="${PROTOCOLO:-http}" "$@"
echo "Reporte: $SALIDA/reporte/index.html"
