# Cloudflare deployment plan

## Current safe target
Deploy the browser client to Cloudflare Pages while keeping the authoritative Colyseus server separate.

### Pages settings
- Root directory: repository root
- Build command: `bash scripts/build-pages.sh`
- Build output directory: `client/dist`
- Node.js: 22.18+
- pnpm: 12.14.0 via Corepack
- Required environment variable: `VITE_SERVER_URL=https://<our-game-server>`

`build-pages.sh` intentionally fails if `VITE_SERVER_URL` is missing or not HTTPS, preventing accidental builds that point at the wrong origin.

## Server requirements for phase 1
The Node game server must provide:
- HTTPS/WSS reachable by browsers
- PostgreSQL 14+ and Redis 6+
- CORS/origin policy allowing only our Pages/custom domains as appropriate
- persistent secrets/config outside Git
- health/logging/backup strategy

Cloudflare can still sit in front of the server endpoint for DNS/TLS/proxying where compatible.

## Why Pages alone is not enough
The current server uses Node packages and long-lived multiplayer WebSocket state. Static Pages hosts the built browser assets; it does not automatically convert the Colyseus server into a Cloudflare-native stateful service.

## Phase 2 mapping
- Colyseus room authority -> Durable Objects or an intentionally redesigned Workers-compatible room layer
- PostgreSQL -> keep PostgreSQL via Hyperdrive or migrate selected relational data to D1 after compatibility review
- Redis transient coordination -> Durable Object/KV design depending on consistency requirements
- static/media assets -> Pages/R2
- scheduled maintenance -> Workers Cron/Workflows where appropriate

## Deployment gate
Before public release:
1. `python3 scripts/verify-agis.py`
2. `pnpm -r typecheck`
3. `pnpm test`
4. `pnpm build`
5. start game server with isolated test database
6. run multiplayer smoke + quest/login/persistence tests
7. verify browser HTTPS/WSS from Pages origin
8. verify backups and rollback
