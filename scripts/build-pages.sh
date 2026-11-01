#!/usr/bin/env bash
set -euo pipefail

# Pages can build the client before the authoritative game server is deployed.
# If VITE_SERVER_URL is provided, require HTTPS. If it is unset, the client
# falls back to location.origin in production (see client/src/config.ts).
if [[ -n "${VITE_SERVER_URL:-}" && "${VITE_SERVER_URL}" != https://* ]]; then
  echo 'VITE_SERVER_URL must use HTTPS' >&2
  exit 1
fi

corepack pnpm install --frozen-lockfile
corepack pnpm build
