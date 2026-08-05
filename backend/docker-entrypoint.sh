#!/bin/sh
set -e

# Las migraciones corren ANTES de aceptar el primer request.
#
# Sin esto, `docker compose up` deja una API viva contra una base sin tablas: el
# healthcheck responde y el primer POST revienta. Que el arranque falle temprano y
# ruidoso es preferible a servir trafico sobre un esquema incompleto.
#
# `depends_on: service_healthy` en el compose garantiza que Postgres ya acepta
# conexiones cuando llegamos aqui.
echo "Aplicando migraciones..."
alembic upgrade head

exec "$@"
