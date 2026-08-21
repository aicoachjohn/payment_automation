#!/usr/bin/env bash
#
# Vercel build. Referenced by vercel.json → buildCommand.
#
# prisma/schema.prisma declares two connections (FR-SEC-11): `url` for runtime queries and
# `directUrl` for migrations, which take advisory locks a transaction pooler cannot carry.
# Prisma validates BOTH whenever it reads the schema — including during `generate` — so an
# empty DIRECT_URL fails the build before anything else runs.
#
# Hosts name the direct connection inconsistently: the Neon-Vercel integration provisions it
# as DATABASE_URL_UNPOOLED, other setups as POSTGRES_URL_NON_POOLING. Rather than make the
# person deploying know that, try each in turn.
set -euo pipefail

if [ -z "${DIRECT_URL:-}" ]; then
  # First non-empty candidate wins. An explicitly set DIRECT_URL always takes precedence.
  for candidate in "${DATABASE_URL_UNPOOLED:-}" "${POSTGRES_URL_NON_POOLING:-}" "${DATABASE_URL:-}"; do
    if [ -n "$candidate" ]; then
      export DIRECT_URL="$candidate"
      break
    fi
  done
fi

if [ -z "${DIRECT_URL:-}" ]; then
  # Prisma's own message ("resolved to an empty string") does not say what to do about it.
  cat >&2 <<'MSG'

────────────────────────────────────────────────────────────────────────────
BUILD STOPPED: no database connection is configured.

This app needs two environment variables in Vercel
(Settings → Environment Variables), from your Neon project:

  DATABASE_URL   the POOLED connection string  (host contains "-pooler")
  DIRECT_URL     the DIRECT connection string  (same host, no "-pooler")

They differ only in the host. DATABASE_URL serves runtime queries; DIRECT_URL
runs migrations, which cannot go through a connection pooler.

Check they are enabled for the environment you are deploying — a value saved
only for Production does not exist in a Preview build.

Full walkthrough: docs/VERCEL_DEPLOYMENT.md
────────────────────────────────────────────────────────────────────────────

MSG
  exit 1
fi

# Warn rather than fail: a pooled URL usually still applies migrations, and refusing to
# deploy over a guess about the host name would be worse than letting Postgres object.
case "${DIRECT_URL}" in
  *-pooler*)
    echo "WARNING: DIRECT_URL points at a POOLED host (-pooler). Migrations may fail on" >&2
    echo "         advisory locks. Use the direct connection string instead." >&2
    ;;
esac

echo "Generating Prisma Client…"
prisma generate

echo "Applying database migrations…"
prisma migrate deploy

echo "Building the application…"
next build
