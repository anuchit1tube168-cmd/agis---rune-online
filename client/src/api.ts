// Account / character HTTP API client (server/src/api.ts). The session token lives in localStorage so a
// refresh goes straight back to character select.
import type { CharacterSummary, LoginResponse } from "../../shared/look.ts";
import { SERVER } from "./config.ts";

const TOKEN = "rl.token", USER = "rl.username";
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export const session = {
  get token() { return store.get(TOKEN); },
  get username() { return store.get(USER) ?? ""; },
  save(r: LoginResponse) { store.set(TOKEN, r.token); store.set(USER, r.username); },
  clear() { store.set(TOKEN, null); },
};

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

// Cloudflare Pages can be brought online before the authoritative Colyseus/Postgres/Redis server exists.
// This demo adapter is intentionally browser-local and has NO admin or server privileges. It lets us verify
// the login -> character select -> local demo world UX without weakening the real server authentication path.
export const DEMO = {
  enabled: import.meta.env.VITE_DEMO_MODE === "1" || location.hostname === "agis-rune-online.pages.dev" || location.hostname.endsWith(".agis-rune-online.pages.dev"),
  username: "agis",
  password: "Agis2026!",
  token: "demo:agis",
} as const;

const DEMO_CHARS = "agis.demo.characters.v1";
const demoActive = () => DEMO.enabled && session.token === DEMO.token;

function defaultDemoCharacters(): CharacterSummary[] {
  return [{
    id: 900001, slot: 0, name: "Agis", job: "Novice", level: 12, jobLevel: 8, exp: 2480, jobExp: 910,
    str: 12, agi: 10, vit: 11, int: 9, dex: 12, luk: 8,
    hp: 420, maxHp: 420, sp: 95, maxSp: 95,
    gender: "M", hair: 5, style: 4,
    look: { gender: "M", hair: 5, style: 4, outfit: "novice", weapon: "blade", shield: null, headgear: null, garment: null },
    map: "f1_field01",
  }];
}

function readDemoCharacters(): CharacterSummary[] {
  try {
    const raw = localStorage.getItem(DEMO_CHARS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as CharacterSummary[];
    }
  } catch { /* reset to the safe seed below */ }
  const seeded = defaultDemoCharacters();
  writeDemoCharacters(seeded);
  return seeded;
}
function writeDemoCharacters(chars: CharacterSummary[]) {
  try { localStorage.setItem(DEMO_CHARS, JSON.stringify(chars)); } catch { /* private mode */ }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SERVER}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `request failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  register: (username: string, password: string) => {
    if (DEMO.enabled) return Promise.reject(new ApiError(`Demo mode: use ${DEMO.username} / ${DEMO.password}`, 503));
    return call<LoginResponse>("POST", "/register", { username, password });
  },
  login: (username: string, password: string) => {
    if (DEMO.enabled && username === DEMO.username && password === DEMO.password) {
      return Promise.resolve<LoginResponse>({ token: DEMO.token, username: DEMO.username });
    }
    if (DEMO.enabled) return Promise.reject(new ApiError(`Demo login: ${DEMO.username} / ${DEMO.password}`, 401));
    return call<LoginResponse>("POST", "/login", { username, password });
  },
  logout: () => demoActive() ? Promise.resolve<{ ok: true }>({ ok: true }) : call<{ ok: true }>("POST", "/logout").catch(() => ({ ok: true })),
  characters: () => demoActive() ? Promise.resolve(readDemoCharacters()) : call<CharacterSummary[]>("GET", "/characters"),
  create: (c: { slot: number; name: string; gender: string; hair: number; style?: number }) => {
    if (!demoActive()) return call<CharacterSummary>("POST", "/characters", c);
    const chars = readDemoCharacters();
    if (chars.some((x) => x.slot === c.slot)) return Promise.reject(new ApiError("that slot is already used", 409));
    if (chars.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) return Promise.reject(new ApiError("that name is taken", 409));
    const gender = c.gender === "F" ? "F" : "M";
    const next: CharacterSummary = {
      id: Math.max(900001, ...chars.map((x) => x.id)) + 1, slot: c.slot, name: c.name, job: "Novice", level: 1, jobLevel: 1, exp: 0, jobExp: 0,
      str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1, hp: 80, maxHp: 80, sp: 20, maxSp: 20,
      gender, hair: c.hair, style: c.style ?? 0,
      look: { gender, hair: c.hair, style: c.style ?? 0, outfit: "novice", weapon: null, shield: null, headgear: null, garment: null },
      map: "f1_field01",
    };
    chars.push(next); writeDemoCharacters(chars); return Promise.resolve(next);
  },
  remove: (id: number, confirmName: string) => {
    if (!demoActive()) return call<{ ok: true }>("DELETE", `/characters/${id}`, { confirmName });
    const chars = readDemoCharacters(), found = chars.find((x) => x.id === id);
    if (!found) return Promise.reject(new ApiError("character not found", 404));
    if (found.name !== confirmName) return Promise.reject(new ApiError("type the character's exact name to delete it", 400));
    writeDemoCharacters(chars.filter((x) => x.id !== id));
    return Promise.resolve<{ ok: true }>({ ok: true });
  },
};
