#!/usr/bin/env bash
set -euo pipefail
: "${VITE_SERVER_URL:?Set VITE_SERVER_URL to your own HTTPS game server}"
case "$VITE_SERVER_URL" in
  https://*) ;;
  *) echo 'VITE_SERVER_URL must use HTTPS' >&2; exit 1 ;;
esac
corepack pnpm install --frozen-lockfile
corepack pnpm build
