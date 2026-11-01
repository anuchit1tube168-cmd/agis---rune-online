# Game content catalog

`agis/game-content.sqlite` is a portable catalog of the upstream game-definition data. It is designed for Drive backup, search, reporting and AI-assisted development.

## Schema
`content(category, record_key, payload_json, source_path)` with primary key `(category, record_key)` and JSON validity enforcement.

## Snapshot counts
- items: 473
- jobs: 40
- meta: 11
- mobs: 43
- pets: 10
- skill_tree: 40
- skills: 311
- tables: 7

## Rules
- Runtime edits still happen in the source under `shared/data/`.
- Treat the SQLite file as derived/catalog data unless an export+validation pipeline is deliberately used.
- Any future editor must validate IDs/keys, schema shape, references and tests before replacing runtime JSON.
- Player/account/character/inventory persistence is a separate database concern handled by `server/migrations/`.

## Recommended future flow
`shared/data -> validate -> rebuild catalog -> verify counts/checksums -> tests -> build`.
This keeps AI/content tooling from silently bypassing the authoritative game source.
