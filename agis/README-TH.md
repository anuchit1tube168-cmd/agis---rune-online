# AGIS Rune Game Base

สำเนาซอร์ส Rune Online 2.6.0 สำหรับพัฒนาเกมของเรา
ต้นทาง: https://github.com/natthphong/rune-online
Archive commit: c7a566e7752f51cdf31952d080ba5de387ab53c9

## สิ่งที่เก็บไว้
- ซอร์สและ assets ทั้งหมดจาก upstream v2.6.0 โดยไม่แก้ไข repository ต้นทาง
- LICENSE GPL-3.0 และ assets/CREDITS.md คงเดิม
- game-content.sqlite: ฐานข้อมูลเนื้อหาเกม เก็บ JSON เต็มของแต่ละรายการในตาราง content
- SOURCE_MANIFEST.json: SHA-256 ของไฟล์ต้นฉบับและจำนวนรายการ
- server/migrations: โครงสร้าง PostgreSQL ต้นฉบับ 19 migrations

ฐานข้อมูล SQLite นี้เป็นคลังเนื้อหาและ snapshot สำหรับ Google Drive/AI ไม่ใช่ฐานข้อมูลผู้เล่นที่เชื่อมกับเกมแล้ว
ข้อมูลแต่ละหมวดอ่านได้ด้วย `SELECT record_key,payload_json FROM content WHERE category='items';`
ไฟล์ JSON ต้นฉบับอยู่ใน `shared/data` และยังเป็นแหล่งข้อมูลที่เกมใช้งาน
หากแก้ใน SQLite ต้องทำขั้นตอน export/validate กลับไปยัง `shared/data` ก่อน build

## Cloudflare Pages
- Repository root: `/`
- Build command: `bash scripts/build-pages.sh`
- Output: `client/dist`
- Node: 22.18 ขึ้นไป ตามข้อกำหนดต้นฉบับ
- pnpm: 12.14.0 ตาม packageManager
- Environment: `VITE_SERVER_URL` เป็น HTTPS URL ของ game server ของเรา
- `wrangler.toml` เตรียมสำหรับ Cloudflare Pages แล้ว; การ deploy จริงต้องเชื่อม repo/build environment ให้ถูกต้อง

Client ใช้ `VITE_SERVER_URL` ได้อยู่แล้ว ห้ามใช้ URL เซิร์ฟเวอร์ของผู้สร้างต้นฉบับ
Colyseus + PostgreSQL + Redis ต้องรันบนเซิร์ฟเวอร์ Node/container แยกใน Phase 1
ก่อนเปิดเล่น ต้องกำหนด CORS ให้รองรับ Pages domain และทดสอบ HTTPS/WebSocket, register/login, multiplayer และ persistence
หากจะใช้ Workers/Durable Objects ทั้งหมด ต้อง port server ใหม่ ไม่สามารถอัปโหลด Node server เดิมลง Pages แล้วเล่นได้ทันที

## สถานะตรวจสอบ
- Repository ของเรา: `anuchit1tube168-cmd/agis---rune-online` (branch `main`)
- Source/assets ถูก import จาก upstream tag `v2.6.0` commit `c7a566e7752f51cdf31952d080ba5de387ab53c9` ผ่าน GitHub Actions แล้ว โดยไม่แตะ repository ต้นทาง
- Content catalog เป้าหมาย: 975 records / 8 categories และตรวจด้วย `PRAGMA integrity_check`
- `SOURCE_MANIFEST.json` ใช้ตรวจ provenance และ checksum ของ snapshot
- CI/Build ของ AGIS จะติดตั้ง dependencies แล้วรัน typecheck, tests และ client build ก่อนถือว่าพร้อม deploy
- Release binaries (DMG/EXE) ไม่ใช่ source-of-truth ของ repo นี้; หากต้องการ release desktop ของเราให้ build ใหม่จาก source และตรวจ digest

## GitHub operating rule
1. ใช้ `anuchit1tube168-cmd/agis---rune-online` เป็น working repository ของเรา
2. `natthphong/rune-online` เป็น upstream reference-only ห้าม push หรือเปิด PR ไปแก้ต้นทางจากงาน AGIS
3. ก่อน sync เวอร์ชันใหม่ ให้เทียบ upstream commit/tag ก่อน แล้ว merge เฉพาะสิ่งที่ต้องการโดยรักษา `AGENTS.md`, `SKILL.md`, `.ai/`, `agis/`, `docs/`, `scripts/` และ config ของเรา
4. เก็บ GPL-3.0, attribution และ `assets/CREDITS.md` เดิมไว้

ต้นฉบับระบุโครงการเพื่อการศึกษา/non-commercial ใน README ควรคงคำอธิบายและเครดิตเดิมไว้เมื่อจัดทำสำเนา

## AGIS Game Expert
ไฟล์กลางสำหรับให้ AI ทุกตัวทำงานจากกติกาเดียวกัน:
- `AGENTS.md` กติกากลางของ repository
- `SKILL.md` ผู้เชี่ยวชาญเกมหลัก 1 คน
- `.ai/game-expert/SKILL.md` mirror สำหรับเครื่องมือ AI ที่ค้น skill ใน `.ai`
- `docs/AGIS-ARCHITECTURE.md` แผนผังระบบ
- `docs/CLOUDFLARE-DEPLOYMENT.md` แผน Cloudflare แบบปลอดภัย
- `docs/CONTENT-DATABASE.md` กติกาฐาน content
- `scripts/rebuild-agis-catalog.py` สร้าง SQLite/manifest ใหม่จาก `shared/data`
- `scripts/verify-agis.py` ตรวจ integrity/snapshot/counts
- `.github/workflows/agis-verify.yml` CI gate สำหรับ repo ของเรา

รันตรวจฐานได้ด้วย `python3 scripts/verify-agis.py` ก่อนทุกงานใหญ่
