#!/bin/sh
set -e

echo "Aplicando migraciones..."
alembic upgrade head

# El puerto lo decide el entorno.
#
# En local el compose no define PORT y se usa 8000. Los proveedores gestionados
# (Railway, Render, Fly...) asignan uno al azar en $PORT y esperan que el proceso
# escuche exactamente ahi: si la app se queda fija en 8000, el despliegue termina
# bien pero el healthcheck nunca responde y el servicio se marca como caido.
: "${PORT:=8000}"
export PORT

exec "$@"
