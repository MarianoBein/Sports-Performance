#!/bin/bash
# Arma una base igual a Supabase (mismos permisos por defecto) con todos los SQL en orden.
# Uso: ./reconstruir.sh <base> [hasta]   (necesita Postgres local en el puerto 5433)
set -e
cd "$(dirname "$0")"
DBN=$1; HASTA=${2:-999}
P="psql -h localhost -p 5433 -U postgres"
$P -qc "drop database if exists $DBN" -c "create database $DBN" >/dev/null 2>&1
$P -d $DBN -q -v ON_ERROR_STOP=1 -f base_supabase.sql >/dev/null
for f in $(ls ../[0-9][0-9][0-9]_*.sql | sort); do
  n=$(basename $f | cut -c1-3); [ "$n" = "002" ] && continue   # el 002 nunca se corrió: lo reemplaza el 015
  [ "$n" \> "$HASTA" ] && break
  $P -d $DBN -q -v ON_ERROR_STOP=1 -f $f >/dev/null 2>/tmp/err_$DBN.txt || { echo "FALLÓ $f"; grep -v NOTICE /tmp/err_$DBN.txt | head -3; exit 1; }
done
echo "$DBN listo"
