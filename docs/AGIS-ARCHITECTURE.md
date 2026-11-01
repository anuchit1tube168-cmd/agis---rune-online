# AGIS Rune Game Base — Architecture

## Baseline
Upstream snapshot: Rune Online / Runebound Legacy v2.6.0, commit `c7a566e7752f51cdf31952d080ba5de387ab53c9`.

The original project is an authoritative 2.5D MMORPG with one codebase supporting web/server development and a desktop standalone mode.

## Runtime boundaries

### Client
`client/` is a Vite + Three.js TypeScript app. It connects to the game server through the Colyseus SDK. Production builds use `VITE_SERVER_URL`; without that variable the production client falls back to its own origin.

### Authoritative server
`server/` owns account/session APIs, Colyseus rooms, movement/gameplay authority, quests, inventory, skills, party/friends/duel/pets and persistence. It is Node.js software and expects PostgreSQL + Redis in normal production mode.

### Shared rules/content
`shared/` contains data/rules consumed across client and server. This is the runtime source of truth for items, jobs, mobs, skills and related tables.

### Desktop
`desktop/` packages client + server in Electron. In simple mode it replaces external PostgreSQL with PGlite and Redis with an in-memory stand-in, storing data locally. Install mode reconnects to regular PostgreSQL/Redis.

## AGIS additions
- `AGENTS.md`: cross-AI operating rules.
- `SKILL.md` and `.ai/game-expert/SKILL.md`: single game-expert agent contract.
- `agis/SOURCE_MANIFEST.json`: upstream provenance/checksums/content counts.
- `agis/game-content.sqlite`: searchable snapshot of game content for Drive/AI use.
- `scripts/verify-agis.py`: integrity and structure checks.
- `wrangler.toml` + `scripts/build-pages.sh`: Cloudflare Pages client build scaffold.

## Cloud target

### Phase 1 — fastest usable web build
Cloudflare Pages serves `client/dist`. The game server remains an external Node service with PostgreSQL + Redis, fronted by HTTPS/WSS. `VITE_SERVER_URL` points only to our endpoint.

### Phase 2 — Cloudflare-native realtime
Port authoritative room/session state to Durable Objects, choose D1 or Hyperdrive/PostgreSQL for durable relational data, and use R2 for larger object assets/backups where useful. This is a server rewrite/adapter project, not a configuration-only deployment.

## Data separation
1. Game-definition content: `shared/data/`.
2. AGIS content catalog: `agis/game-content.sqlite`.
3. Player/account runtime data: PostgreSQL/PGlite migrations under `server/migrations/`.
4. Redis/in-memory state: transient sessions, online/rate-limit coordination.
5. Google Drive: backup/project knowledge layer, not realtime gameplay storage.
