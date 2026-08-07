#!/bin/sh
set -e

# La base tiene que estar configurada ANTES de intentar nada.
#
# Sin esta comprobacion, un despliegue sin DATABASE_URL cae al valor por defecto
# de config.py —localhost:5432, o sea el propio contenedor— y falla quince lineas
# adentro de un traceback de SQLAlchemy con "connection refused". Lo que se ve en
# el proveedor es "healthcheck failed", que no dice nada sobre la causa real.
#
# En el compose local la variable siempre viene definida, asi que esto solo se
# dispara donde de verdad importa: en un despliegue mal configurado.
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL no esta definida." >&2
  echo "" >&2
  echo "La aplicacion no sabe a que base conectarse. Configurala en el entorno:" >&2
  echo "  DATABASE_URL=postgresql://usuario:clave@host:5432/base" >&2
  echo "" >&2
  echo "El prefijo postgresql:// se normaliza solo al driver que usamos." >&2
  exit 1
fi

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
