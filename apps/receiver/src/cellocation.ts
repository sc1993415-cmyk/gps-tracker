import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const CACHE_PATH = path.join(DATA_DIR, "cellocation-cache.json");
const QUOTA_PATH = path.join(DATA_DIR, "cellocation-quota.json");

const API = "http://api.cellocation.com:84/cell/";
const DAILY_LIMIT = Number(process.env.CELLOCATION_DAILY_LIMIT) || 1000;
const NEGATIVE_TTL_MS = 6 * 60 * 60 * 1000;

export type CellocationHit = {
  lat: number;
  lng: number;
  range: number;
  address?: string;
  match: "cellocation";
};

type CacheEntry = {
  ok: boolean;
  lat?: number;
  lng?: number;
  range?: number;
  address?: string;
  errcode?: number;
  ts: number;
};

type Quota = { day: string; used: number };

const mem = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CellocationHit | null>>();
let quota: Quota = { day: today(), used: 0 };
let loaded = false;

function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function key(mcc: number, mnc: number, lac: number, ci: number) {
  return `${mcc}:${mnc}:${lac}:${ci}`;
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8") || "{}") as Record<
        string,
        CacheEntry
      >;
      for (const [k, v] of Object.entries(raw)) {
        if (v && typeof v.ts === "number") mem.set(k, v);
      }
    }
  } catch (err) {
    console.warn("[cellocation] cache load failed", err);
  }
  try {
    if (fs.existsSync(QUOTA_PATH)) {
      const q = JSON.parse(fs.readFileSync(QUOTA_PATH, "utf8") || "{}") as Quota;
      if (q?.day === today()) quota = { day: q.day, used: Number(q.used) || 0 };
    }
  } catch (err) {
    console.warn("[cellocation] quota load failed", err);
  }
  rotateQuota();
  console.log(
    `[cellocation] cache=${mem.size} quota=${quota.used}/${DAILY_LIMIT} day=${quota.day}`
  );
}

function rotateQuota() {
  const d = today();
  if (quota.day !== d) quota = { day: d, used: 0 };
}

function persistCache() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const obj: Record<string, CacheEntry> = {};
    for (const [k, v] of mem) obj[k] = v;
    fs.writeFileSync(CACHE_PATH, JSON.stringify(obj) + "\n");
  } catch (err) {
    console.warn("[cellocation] cache save failed", err);
  }
}

function persistQuota() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(QUOTA_PATH, JSON.stringify(quota) + "\n");
  } catch (err) {
    console.warn("[cellocation] quota save failed", err);
  }
}

export function getCellocationStats() {
  load();
  rotateQuota();
  return {
    cache: mem.size,
    used: quota.used,
    limit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - quota.used),
    day: quota.day,
  };
}

export function lookupCellocationCached(
  mcc: number,
  mnc: number,
  lac: number,
  ci: number
): CellocationHit | null {
  load();
  if (!Number.isFinite(ci) || ci <= 0) return null;
  const e = mem.get(key(mcc, mnc, lac, ci));
  if (!e || !e.ok) return null;
  if (e.lat == null || e.lng == null) return null;
  return {
    lat: e.lat,
    lng: e.lng,
    range: e.range || 300,
    address: e.address,
    match: "cellocation",
  };
}

function cachedNegativeFresh(e: CacheEntry | undefined) {
  if (!e || e.ok) return false;
  return Date.now() - e.ts < NEGATIVE_TTL_MS;
}

async function fetchOnce(
  mcc: number,
  mnc: number,
  lac: number,
  ci: number
): Promise<CellocationHit | null> {
  load();
  rotateQuota();
  const k = key(mcc, mnc, lac, ci);
  const existing = mem.get(k);
  if (existing?.ok && existing.lat != null) {
    return {
      lat: existing.lat,
      lng: existing.lng!,
      range: existing.range || 300,
      address: existing.address,
      match: "cellocation",
    };
  }
  if (cachedNegativeFresh(existing)) return null;
  if (quota.used >= DAILY_LIMIT) {
    console.warn(`[cellocation] quota exhausted ${quota.used}/${DAILY_LIMIT}`);
    return null;
  }

  quota.used += 1;
  persistQuota();
  const url =
    `${API}?mcc=${mcc}&mnc=${mnc}&lac=${lac}&ci=${ci}` +
    `&coord=wgs84&output=json`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": "gps-tracker-lbs/1.0" },
    });
    clearTimeout(timer);
    const body = (await res.json()) as {
      errcode?: number;
      lat?: string | number;
      lon?: string | number;
      radius?: string | number;
      address?: string;
    };
    const errcode = Number(body.errcode);
    const lat = Number(body.lat);
    const lng = Number(body.lon);
    const range = Number(body.radius);
    if (errcode === 0 && Number.isFinite(lat) && Number.isFinite(lng)) {
      const hit: CacheEntry = {
        ok: true,
        lat,
        lng,
        range: Number.isFinite(range) ? range : 300,
        address: body.address,
        errcode: 0,
        ts: Date.now(),
      };
      mem.set(k, hit);
      persistCache();
      console.log(
        `[cellocation] hit ${k} lat=${lat.toFixed(5)} lng=${lng.toFixed(5)} ` +
          `r=${hit.range} quota=${quota.used}/${DAILY_LIMIT}`
      );
      return {
        lat,
        lng,
        range: hit.range || 300,
        address: hit.address,
        match: "cellocation",
      };
    }
    mem.set(k, { ok: false, errcode, ts: Date.now() });
    persistCache();
    console.log(`[cellocation] miss ${k} errcode=${errcode} quota=${quota.used}/${DAILY_LIMIT}`);
    return null;
  } catch (err) {
    console.warn(`[cellocation] fetch fail ${k}`, err);
    // refund? network fail shouldn't burn quota permanently — refund
    quota.used = Math.max(0, quota.used - 1);
    persistQuota();
    return null;
  }
}

export function requestCellocation(
  mcc: number,
  mnc: number,
  lac: number,
  ci: number,
  onHit?: (hit: CellocationHit) => void
): void {
  if (!Number.isFinite(ci) || ci <= 0) return;
  load();
  const k = key(mcc, mnc, lac, ci);
  const cached = lookupCellocationCached(mcc, mnc, lac, ci);
  if (cached) {
    onHit?.(cached);
    return;
  }
  const neg = mem.get(k);
  if (cachedNegativeFresh(neg)) return;
  rotateQuota();
  if (quota.used >= DAILY_LIMIT) return;

  let p = inflight.get(k);
  if (!p) {
    p = fetchOnce(mcc, mnc, lac, ci).finally(() => inflight.delete(k));
    inflight.set(k, p);
  }
  void p.then((hit) => {
    if (hit) onHit?.(hit);
  });
}
