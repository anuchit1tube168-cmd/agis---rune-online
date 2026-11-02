const te = new TextEncoder();
const USER_RE = /^[a-z0-9_]{4,24}$/;
const NAME_RE = /^[A-Za-z0-9_ ]{2,16}$/;
const SESSION_TTL = 12 * 60 * 60;

type Account = { id: string; username: string; salt: string; hash: string; iterations: number; createdAt: string };
type Session = { accountId: string; username: string };

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const bad = (status: number, error: string) => json({ error }, status);

function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64url(s: string) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function digestToken(token: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(token))));
}
async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveBits"]);
  // Cloudflare Workers WebCrypto is strict about BufferSource types. Copy into a fresh ArrayBuffer
  // instead of passing a Uint8Array whose backing buffer may be typed as ArrayBufferLike/SharedArrayBuffer.
  const saltBuffer = new Uint8Array(salt).buffer;
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations }, key, 256));
}
async function makeAccount(username: string, password: string): Promise<Account> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 120000;
  const hash = await derive(password, salt, iterations);
  return { id: crypto.randomUUID(), username, salt: b64url(salt), hash: b64url(hash), iterations, createdAt: new Date().toISOString() };
}
async function verify(password: string, a: Account) {
  const got = await derive(password, fromB64url(a.salt), a.iterations);
  const want = fromB64url(a.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}
async function createSession(kv: any, s: Session) {
  const token = `demo:${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  await kv.put(`session:${await digestToken(token)}`, JSON.stringify(s), { expirationTtl: SESSION_TTL });
  return token;
}
async function requireSession(req: Request, kv: any): Promise<{ token: string; session: Session } | Response> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return bad(401, "session expired — please log in again");
  const raw = await kv.get(`session:${await digestToken(token)}`);
  if (!raw) return bad(401, "session expired — please log in again");
  return { token, session: JSON.parse(raw) as Session };
}
async function body(req: Request) {
  try { return await req.json() as any; } catch { return {}; }
}
function seedCharacter(username: string) {
  return {
    id: 900001, slot: 0, name: username === "agis" ? "Agis" : username.slice(0, 16), job: "Novice", level: username === "agis" ? 12 : 1, jobLevel: username === "agis" ? 8 : 1,
    exp: username === "agis" ? 2480 : 0, jobExp: username === "agis" ? 910 : 0,
    str: username === "agis" ? 12 : 1, agi: username === "agis" ? 10 : 1, vit: username === "agis" ? 11 : 1,
    int: username === "agis" ? 9 : 1, dex: username === "agis" ? 12 : 1, luk: username === "agis" ? 8 : 1,
    hp: username === "agis" ? 420 : 80, maxHp: username === "agis" ? 420 : 80, sp: username === "agis" ? 95 : 20, maxSp: username === "agis" ? 95 : 20,
    gender: "M", hair: 5, style: 4,
    look: { gender: "M", hair: 5, style: 4, outfit: "novice", weapon: username === "agis" ? "blade" : null, shield: null, headgear: null, garment: null },
    map: "f1_field01",
  };
}

export async function onRequest(context: any) {
  try {
    const req: Request = context.request;
    const kv = context.env.GAME_STATE;
    if (!kv) return bad(503, "game state binding unavailable");
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api\/?/, "");
    const method = req.method.toUpperCase();

    if (method === "OPTIONS") return new Response(null, { status: 204 });
    if (method === "GET" && path === "healthz") return json({ ok: true, service: "agis-rune-edge", store: "kv", time: new Date().toISOString() });

    if (method === "POST" && path === "register") {
      const b = await body(req);
      const username = String(b.username ?? "").trim().toLowerCase();
      const password = String(b.password ?? "");
      if (!USER_RE.test(username)) return bad(400, "username: 4–24 characters, a–z 0–9 _");
      if (password.length < 8 || password.length > 72) return bad(400, "password: 8–72 characters");
      const key = `user:${username}`;
      if (await kv.get(key)) return bad(409, "that username is taken");
      const account = await makeAccount(username, password);
      await kv.put(key, JSON.stringify(account));
      const c = seedCharacter(username);
      await kv.put(`chars:${account.id}`, JSON.stringify([c]));
      await kv.put(`charname:${c.name.toLowerCase()}`, JSON.stringify({ accountId: account.id, id: c.id }));
      return json({ token: await createSession(kv, { accountId: account.id, username }), username });
    }

    if (method === "POST" && path === "login") {
      const b = await body(req);
      const username = String(b.username ?? "").trim().toLowerCase();
      const password = String(b.password ?? "");
      const raw = await kv.get(`user:${username}`);
      if (!raw) return bad(401, "wrong username or password");
      const account = JSON.parse(raw) as Account;
      if (!(await verify(password, account))) return bad(401, "wrong username or password");
      return json({ token: await createSession(kv, { accountId: account.id, username }), username });
    }

    const auth = await requireSession(req, kv);
    if (auth instanceof Response) return auth;
    const { session, token } = auth;
    const charsKey = `chars:${session.accountId}`;

    if (method === "POST" && path === "logout") {
      await kv.delete(`session:${await digestToken(token)}`);
      return json({ ok: true });
    }
    if (method === "GET" && path === "characters") {
      const raw = await kv.get(charsKey);
      return json(raw ? JSON.parse(raw) : []);
    }
    if (method === "POST" && path === "characters") {
      const b = await body(req);
      const name = String(b.name ?? "").trim();
      const slot = Number(b.slot), hair = Number(b.hair), style = b.style === undefined ? 0 : Number(b.style);
      const gender = b.gender === "F" ? "F" : b.gender === "M" ? "M" : "";
      if (!NAME_RE.test(name)) return bad(400, "name: 2–16 letters, numbers, spaces or _");
      if (!Number.isInteger(slot) || slot < 0 || slot > 8) return bad(400, "invalid slot");
      if (!gender) return bad(400, "invalid gender");
      if (!Number.isInteger(hair) || hair < 0 || hair > 31 || !Number.isInteger(style) || style < 0 || style > 31) return bad(400, "invalid look");
      if (await kv.get(`charname:${name.toLowerCase()}`)) return bad(409, "that name is taken");
      const raw = await kv.get(charsKey);
      const chars = raw ? JSON.parse(raw) : [];
      if (chars.some((x: any) => x.slot === slot)) return bad(409, "that slot is already used");
      const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
      const next = {
        id, slot, name, job: "Novice", level: 1, jobLevel: 1, exp: 0, jobExp: 0,
        str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1, hp: 80, maxHp: 80, sp: 20, maxSp: 20,
        gender, hair, style,
        look: { gender, hair, style, outfit: "novice", weapon: null, shield: null, headgear: null, garment: null },
        map: "f1_field01",
      };
      chars.push(next);
      await kv.put(charsKey, JSON.stringify(chars));
      await kv.put(`charname:${name.toLowerCase()}`, JSON.stringify({ accountId: session.accountId, id }));
      return json(next);
    }
    const del = path.match(/^characters\/(\d+)$/);
    if (method === "DELETE" && del) {
      const b = await body(req);
      const id = Number(del[1]);
      const raw = await kv.get(charsKey);
      const chars = raw ? JSON.parse(raw) : [];
      const found = chars.find((x: any) => x.id === id);
      if (!found) return bad(404, "character not found");
      if (String(b.confirmName ?? "") !== found.name) return bad(400, "type the character's exact name to delete it");
      await kv.put(charsKey, JSON.stringify(chars.filter((x: any) => x.id !== id)));
      await kv.delete(`charname:${found.name.toLowerCase()}`);
      return json({ ok: true });
    }

    return bad(404, "not found");
  } catch (error) {
    console.error("AGIS edge API error", error);
    return bad(500, "edge API runtime error");
  }
}
