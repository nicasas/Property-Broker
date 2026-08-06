#!/bin/sh
# Snapshots periodicos de la base.
#
# Corre en un contenedor aparte con la misma imagen de Postgres que ya usa el
# proyecto: no agrega dependencias ni necesita descargar nada nuevo.
#
# Dos decisiones que hacen que estos backups sirvan de verdad:
#
#   1. ESCRITURA ATOMICA. El dump se escribe primero como `.part` y solo al
#      terminar bien se renombra al nombre final. Sin esto, si el contenedor se
#      cae o la maquina se apaga a mitad de un dump, quedaria un archivo .sql
#      truncado que PARECE un backup valido y que solo se descubre roto el dia
#      que hay que restaurarlo. Un backup a medias es peor que no tener backup,
#      porque da una confianza que no corresponde.
#
#   2. UN FALLO NO MATA EL CICLO. Si un dump falla —la base reiniciandose, por
#      ejemplo— se registra el error, se borra el parcial y se sigue intentando.
#      Un backup automatico que se apaga en silencio al primer problema deja de
#      existir justo cuando mas se necesita.
#
# La retencion evita que el disco crezca sin limite: se conservan los ultimos
# KEEP_LAST y se borran los mas viejos.

set -u

INTERVAL="${BACKUP_INTERVAL_SECONDS:-900}"
KEEP="${KEEP_LAST:-12}"
DIR=/backups

mkdir -p "$DIR"
echo "[backup] cada ${INTERVAL}s, conservando los ultimos ${KEEP}"

while true; do
  stamp=$(date +%Y%m%d-%H%M%S)
  partial="$DIR/.broker-$stamp.sql.part"
  final="$DIR/broker-$stamp.sql"

  if pg_dump -h postgres -U broker -d broker --clean --if-exists > "$partial" 2>/tmp/backup_err; then
    # Renombrar es atomico en el mismo sistema de archivos: el archivo final
    # aparece completo o no aparece.
    mv "$partial" "$final"
    echo "[backup] $(basename "$final") ($(wc -c < "$final") bytes)"

    # Retencion: los mas nuevos primero, se borra a partir del KEEP+1.
    ls -1t "$DIR"/broker-*.sql 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
      rm -f "$old"
      echo "[backup] rotado: $(basename "$old")"
    done
  else
    rm -f "$partial"
    echo "[backup] FALLO: $(head -c 200 /tmp/backup_err)"
  fi

  sleep "$INTERVAL"
done
