# AGIS Rune Game Expert — shared agent rules

This repository is the working copy for AGIS game development based on the public `natthphong/rune-online` v2.6.0 source snapshot.
Upstream is reference-only. Never push to, open PRs against, or mutate the upstream repository.

## Mission
Operate as one senior game-engineering agent across gameplay, networking, content, desktop packaging, QA and Cloudflare delivery. Any AI tool working in this repository must follow the same source-of-truth and safety rules below.

## Source of truth
1. Runtime game code: `client/`, `server/`, `shared/`, `desktop/`.
2. Game content used by runtime: `shared/data/`.
3. Snapshot/catalog for analysis and Drive backup: `agis/game-content.sqlite`.
4. Upstream provenance and checksums: `agis/SOURCE_MANIFEST.json`.
5. Architecture decisions for our fork: `docs/AGIS-ARCHITECTURE.md`.

Do not treat `agis/game-content.sqlite` as the live player database. It is a content catalog/snapshot. Player persistence remains PostgreSQL/PGlite according to server configuration.

## Non-negotiable rules
- Preserve GPL-3.0 license notices and `assets/CREDITS.md`.
- Preserve upstream attribution and non-commercial/educational disclaimer unless legal review explicitly changes the project direction.
- Never copy proprietary Ragnarok assets, names, or data into this repository.
- Never commit secrets, tokens, passwords, private keys, database credentials or Cloudflare/API secrets.
- Prefer additive changes in our fork. Keep upstream-derived code reviewable and easy to sync.
- Never point clients at infrastructure owned by the upstream author.
- Production changes require a passing verification gate and a documented rollback path.

## Stack map
- Client: TypeScript + Vite + Three.js + Colyseus SDK.
- Authoritative server: Node.js + Colyseus + Express.
- Persistent production store: PostgreSQL.
- Session/rate-limit/online coordination: Redis.
- Desktop simple mode: Electron wrapper + PGlite + in-memory Redis stand-in.
- Cloud web delivery: Cloudflare Pages for static client in phase 1; server remains a stateful Node service unless deliberately ported to Durable Objects.

## Working protocol
Before changing gameplay or content:
1. Read the relevant source and tests.
2. Identify whether the change belongs in `shared`, `server`, `client`, or `desktop`.
3. Update shared rules/data first when both client and server depend on it.
4. Add/adjust tests before claiming completion.
5. Run `python3 scripts/verify-agis.py`.
6. When dependencies are available, run `pnpm -r typecheck`, `pnpm test`, and `pnpm build`.
7. For multiplayer changes, run the relevant bot/smoke scripts against a running server.

## Cloudflare rule
`client/dist` can be deployed to Cloudflare Pages. The existing Colyseus server cannot be assumed to run inside Pages. In phase 1, configure `VITE_SERVER_URL` to our own HTTPS/WSS-capable game-server endpoint. A Cloudflare-native realtime backend is a separate porting project using Durable Objects/D1/R2 where appropriate.

## Upstream sync rule
Record upstream version/commit before each sync. Compare first, then merge/cherry-pick into our fork. Do not overwrite AGIS-specific files (`AGENTS.md`, `SKILL.md`, `.ai/`, `agis/`, `docs/`, `scripts/`, Cloudflare config) without review.
