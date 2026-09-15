/**
 * Offline OpenCelliD lookup for China MCC 460.
 * Primary key is LAC-level (mcc:mnc:lac) → centroid of all cells in that LAC.
 * Exact CI match is an optional fine-tune when the cell id is present in the DB.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

export type CellMatch = "exact" | "lac" | "lac_any_mnc";

export type CellHit = {
  lat: number;
  lng: number;
  range?: number;
  match: CellMatch;
};

type LacAgg = { sumLat: number; sumLon: number; n: number; sumRange: number };

const exactMap = new Map<string, { lat: number; lng: number; range: number }>();
/** mcc:mnc:lac → aggregate centroid */
const lacMap = new Map<string, LacAgg>();
/** mcc:lac → aggregate across any mnc (fallback) */
const lacAnyMncMap = new Map<string, LacAgg>();

let loaded = false;
let loadedPath: string | null = null;
let rowCount = 0;

function moduleDir(): string {
  try {
    // tsx / ESM: import.meta.url
    const u = import.meta.url;
    if (u) return path.dirname(fileURLToPath(u));
  } catch {
    /* ignore */
  }
  // Fallback when dirname unavailable
  return path.join(process.cwd(), "apps/receiver/src");
}

export function defaultCellDbPaths(): string[] {
  const env = process.env.CELL_DB_PATH?.trim();
  const paths: string[] = [];
  if (env) paths.push(env);
  paths.push(path.join(process.cwd(), "apps/receiver/data/opencellid-460.csv.gz"));
  paths.push(path.join(process.cwd(), "data/opencellid-460.csv.gz"));
  paths.push(path.join(moduleDir(), "../data/opencellid-460.csv.gz"));
  return paths;
}

function lacKey(mcc: number, mnc: number, lac: number): string {
  return `${mcc}:${mnc}:${lac}`;
}

function exactKey(mcc: number, mnc: number, lac: number, ci: number): string {
  return `${mcc}:${mnc}:${lac}:${ci}`;
}

function lacAnyKey(mcc: number, lac: number): string {
  return `${mcc}:${lac}`;
}

function addAgg(map: Map<string, LacAgg>, key: string, lat: number, lon: number, range: number) {
  let a = map.get(key);
  if (!a) {
    a = { sumLat: 0, sumLon: 0, n: 0, sumRange: 0 };
    map.set(key, a);
  }
  a.sumLat += lat;
  a.sumLon += lon;
  a.sumRange += range;
  a.n += 1;
}

function centroid(a: LacAgg): { lat: number; lng: number; range: number } {
  return {
    lat: a.sumLat / a.n,
    lng: a.sumLon / a.n,
    range: a.sumRange / a.n,
  };
}

function parseCsvLine(line: string): void {
  // radio,mcc,mnc,lac,cellid,unit,lon,lat,range,samples,...
  const parts = line.split(",");
  if (parts.length < 9) return;
  const mcc = Number(parts[1]);
  const mnc = Number(parts[2]);
  const lac = Number(parts[3]);
  const ci = Number(parts[4]);
  const lon = Number(parts[6]);
  const lat = Number(parts[7]);
  const range = Number(parts[8]) || 0;
  if (![mcc, mnc, lac, ci, lon, lat].every(Number.isFinite)) return;
  if (lat === 0 && lon === 0) return;

  exactMap.set(exactKey(mcc, mnc, lac, ci), { lat, lng: lon, range });
  addAgg(lacMap, lacKey(mcc, mnc, lac), lat, lon, range);
  addAgg(lacAnyMncMap, lacAnyKey(mcc, lac), lat, lon, range);
  rowCount++;
}

function loadFromBuffer(buf: Buffer): void {
  exactMap.clear();
  lacMap.clear();
  lacAnyMncMap.clear();
  rowCount = 0;

  let text: string;
  // gzip magic 1f 8b
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    text = zlib.gunzipSync(buf).toString("utf8");
  } else {
    text = buf.toString("utf8");
  }

  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("radio") || line.startsWith("#")) continue;
    parseCsvLine(line);
  }
}

/**
 * Load OpenCelliD CSV(.gz). Idempotent — subsequent calls are no-ops once loaded.
 * Returns row count, or 0 if no file found.
 */
export function loadDb(dbPath?: string): number {
  if (loaded && !dbPath) return rowCount;

  const candidates = dbPath ? [dbPath] : defaultCellDbPaths();
  let found: string | null = null;
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p) && fs.statSync(p).isFile()) {
        found = p;
        break;
      }
    } catch {
      /* try next */
    }
  }

  if (!found) {
    console.warn(
      `[cell] OpenCelliD DB not found; tried: ${candidates.join(" | ")}`
    );
    loaded = true;
    loadedPath = null;
    return 0;
  }

  const buf = fs.readFileSync(found);
  loadFromBuffer(buf);
  loaded = true;
  loadedPath = found;
  console.log(`[cell] loaded OpenCelliD rows=${rowCount} path=${found}`);
  return rowCount;
}

/** Ensure DB is loaded once (sync). Safe to call at startup and before lookup. */
export function ensureCellDbLoaded(dbPath?: string): number {
  if (loaded && !dbPath) return rowCount;
  return loadDb(dbPath);
}

export function getCellDbStats(): { loaded: boolean; path: string | null; rows: number } {
  return { loaded, path: loadedPath, rows: rowCount };
}

/**
 * Resolve cell → lat/lng.
 * Primary: mcc+mnc+lac centroid (match="lac").
 * Optional fine-tune: exact CI when present (match="exact").
 * Fallback: same mcc+lac any mnc (match="lac_any_mnc").
 */
export function lookupCell(
  mcc: number,
  mnc: number,
  lac: number,
  ci?: number
): CellHit | null {
  ensureCellDbLoaded();

  if (!Number.isFinite(mcc) || !Number.isFinite(mnc) || !Number.isFinite(lac)) {
    return null;
  }

  // Optional fine-tune: exact CI when it hits
  if (ci != null && Number.isFinite(ci)) {
    const ex = exactMap.get(exactKey(mcc, mnc, lac, ci));
    if (ex) {
      return { lat: ex.lat, lng: ex.lng, range: ex.range, match: "exact" };
    }
  }

  // Primary product path: LAC centroid for mcc:mnc:lac
  const lacHit = lacMap.get(lacKey(mcc, mnc, lac));
  if (lacHit && lacHit.n > 0) {
    const c = centroid(lacHit);
    return { lat: c.lat, lng: c.lng, range: c.range, match: "lac" };
  }

  // Broader fallback: same MCC+LAC, any MNC
  const anyHit = lacAnyMncMap.get(lacAnyKey(mcc, lac));
  if (anyHit && anyHit.n > 0) {
    const c = centroid(anyHit);
    return { lat: c.lat, lng: c.lng, range: c.range, match: "lac_any_mnc" };
  }

  return null;
}

/**
 * Exact CI-only hit — no LAC / any-MNC fallback.
 * Used to decide whether the online cellocation API is worth asking: when the
 * offline OpenCelliD dump has no row for this cell, `lookupCell` would still
 * answer with a LAC centroid (hundreds of metres off), so ask the API first.
 */
export function lookupCellExact(
  mcc: number,
  mnc: number,
  lac: number,
  ci?: number
): CellHit | null {
  if (ci == null || !Number.isFinite(ci) || ci <= 0) return null;
  if (!Number.isFinite(mcc) || !Number.isFinite(mnc) || !Number.isFinite(lac)) {
    return null;
  }
  ensureCellDbLoaded();
  const ex = exactMap.get(exactKey(mcc, mnc, lac, ci));
  if (!ex) return null;
  return { lat: ex.lat, lng: ex.lng, range: ex.range, match: "exact" };
}

/** Test helper: inject a tiny in-memory CSV (resets indexes). */
export function loadDbFromCsvText(csv: string): number {
  loadFromBuffer(Buffer.from(csv, "utf8"));
  loaded = true;
  loadedPath = "(inline)";
  return rowCount;
}

/** Test helper: reset so next ensureCellDbLoaded reloads from disk. */
export function resetCellDbForTests(): void {
  exactMap.clear();
  lacMap.clear();
  lacAnyMncMap.clear();
  loaded = false;
  loadedPath = null;
  rowCount = 0;
}
