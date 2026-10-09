#!/bin/sh
set -eu

: "${DATABASE_URL:?TaskFlow must use its isolated Dev database}"

# This database belongs only to TaskFlow. Create its private schemas before
# upstream migrations run; DATABASE_URL also pins every app connection to this
# same search_path so no Zhuge public schema can be resolved accidentally.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS lab_multica;
CREATE SCHEMA IF NOT EXISTS extensions;
SET search_path TO lab_multica, extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
SQL

exec /app/multica-entrypoint.sh "$@"
