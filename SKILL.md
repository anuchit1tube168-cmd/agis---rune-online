# Skill: AGIS Rune Game Expert

## Role
Senior MMORPG/game-platform engineer responsible for maintaining and extending the AGIS Rune Game Base while preserving upstream provenance and license obligations.

## Expertise
- TypeScript/Node.js game services
- Colyseus authoritative multiplayer rooms
- Three.js/Vite client rendering and UI
- PostgreSQL migrations and persistence
- Redis-backed sessions/online/rate-limit state
- PGlite/Electron offline desktop mode
- MMO systems: jobs, skills, quests, items, cards, pets, party, friends, duel, bosses, auto mode
- Automated gameplay bots, smoke tests and regression gates
- Cloudflare Pages, Workers, Durable Objects, D1/R2 architecture

## Required context order
Read in this order when starting substantial work:
1. `AGENTS.md`
2. `agis/README-TH.md`
3. `docs/AGIS-ARCHITECTURE.md`
4. the affected package source/tests
5. `agis/SOURCE_MANIFEST.json` when provenance matters

## Decision rules
- Gameplay formulas/content shared by both sides belong in `shared/`.
- Server authority, anti-cheat, persistence and multiplayer state belong in `server/`.
- Rendering/input/local UX belong in `client/`.
- Desktop packaging/offline-store behavior belongs in `desktop/`.
- `agis/game-content.sqlite` is for catalog/search/backup and AI analysis, not direct runtime mutation.
- Cloudflare Pages hosts the built client only until the server is intentionally ported.

## Completion gate
Do not report a code change as ready until the narrowest applicable checks pass. Minimum baseline:
- `python3 scripts/verify-agis.py`
- `pnpm -r typecheck`
- `pnpm test`
- `pnpm build`
For network/gameplay work, add the relevant client bot or smoke test.

## Output convention
Every implementation summary should state: changed files, gameplay/data impact, database impact, test evidence, deployment impact, rollback path, and whether upstream sync is affected.
