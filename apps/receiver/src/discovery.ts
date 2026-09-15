import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRoster, getRosterEntry, resolveRosterEntry } from "./roster.ts";

/** Where a sighting came from. H02 ids are numeric; Ucast ids are the cloud SN
 *  or an operator-assigned numeric alias. The ghost heuristics below only make
 *  sense for H02 framing, so the two sources validate differently. */
export type DeviceOrigin = "h02" | "ucast";

export type DiscoveredDevice = {
  device_id: string;
  /** Uplink that produced this candidate (absent in older files => h02). */
  origin?: DeviceOrigin;
  hits: number;
  first_seen_ms: number;
  last_seen_ms: number;
  last_lat: number;
  last_lng: number;
  /** Ready for admin "pending" list (hits threshold met). */
  pending: boolean;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DISCOVERY_PATH = path.resolve(
  process.env.DISCOVERY_PATH || path.resolve(__dirname, "../data/discovered.json")
);

const MIN_HITS = Number(process.env.GPS_DISCOVERY_MIN_HITS) || 3;
/** Keep candidates this long without new hits. */
const TTL_MS = Number(process.env.GPS_DISCOVERY_TTL_MS) || 7 * 24 * 3600_000;

const byId = new Map<string, DiscoveredDevice>();

function persist() {
  try {
    fs.mkdirSync(path.dirname(DISCOVERY_PATH), { recursive: true });
    const list = [...byId.values()].sort((a, b) => b.last_seen_ms - a.last_seen_ms);
    fs.writeFileSync(DISCOVERY_PATH, JSON.stringify(list, null, 2) + "\n", "utf8");
  } catch (err) {
    console.warn("[discovery] persist failed:", err);
  }
}

export function loadDiscovery() {
  try {
    if (!fs.existsSync(DISCOVERY_PATH)) return;
    const parsed = JSON.parse(fs.readFileSync(DISCOVERY_PATH, "utf8") || "[]");
    if (!Array.isArray(parsed)) return;
    const now = Date.now();
    for (const raw of parsed) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const device_id = String(o.device_id ?? "").trim();
      if (!device_id) continue;
      const last_seen_ms = Number(o.last_seen_ms) || now;
      if (now - last_seen_ms > TTL_MS) continue;
      const hits = Number(o.hits) || 1;
      byId.set(device_id, {
        device_id,
        hits,
        first_seen_ms: Number(o.first_seen_ms) || last_seen_ms,
        last_seen_ms,
        last_lat: Number(o.last_lat) || 0,
        last_lng: Number(o.last_lng) || 0,
        origin: o.origin === "ucast" ? "ucast" : "h02",
        pending: hits >= MIN_HITS,
      });
    }
    console.log(`[discovery] loaded ${byId.size} candidate(s)`);
  } catch (err) {
    console.warn("[discovery] load failed:", err);
  }
}

/** Reject doubled-$ ghosts, short fragments, non-digit junk. */
export function isPlausibleDeviceId(deviceId: string): boolean {
  const id = String(deviceId ?? "").trim();
  if (!id) return false;
  // Real H02 short id ~10 digits; IMEI 15 digits. Allow 8–15 digits.
  if (!/^\d{8,15}$/.test(id)) return false;
  // Doubled $ mis-sync often invents ids starting with 24… (e.g. 2470262388)
  if (id.startsWith("24") && id.length === 10) return false;
  // Historical ghosts: bib fragment / name=slice(-6) of 7026238813
  if (id === "2388" || id === "238813" || id.length < 8) return false;
  return true;
}

/**
 * Ucast ids: either the cloud SN (alphanumeric, e.g. CSX9LNY9E5FZK6LAGQZQ) or a
 * numeric alias the operator typed as the second column in the admin panel.
 *
 * The H02 ghost heuristics (doubled-$ ids, IMEI fragments, 24-prefixed noise)
 * are artifacts of H02 framing and cannot occur here, so they are not applied —
 * that is what used to silently swallow every SN-keyed tick as `drop ghost`.
 */
export function isPlausibleUcastDeviceId(deviceId: string): boolean {
  const id = String(deviceId ?? "").trim();
  if (!id) return false;
  if (/^\d{8,15}$/.test(id)) return true;
  return /^[A-Za-z0-9]{8,40}$/.test(id);
}

/** China-ish bbox (researcher); env GPS_DISCOVERY_GLOBAL=1 for wider. */
export function isPlausibleCoord(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  const global = process.env.GPS_DISCOVERY_GLOBAL === "1";
  if (global) return lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180;
  return lat >= 3 && lat <= 54 && lng >= 73 && lng <= 135;
}

export function noteUnknownSighting(
  deviceId: string,
  lat: number,
  lng: number,
  origin: DeviceOrigin = "h02"
): DiscoveredDevice | null {
  const id = String(deviceId ?? "").trim();
  if (origin === "ucast" ? !isPlausibleUcastDeviceId(id) : !isPlausibleDeviceId(id)) {
    return null;
  }
  if (!isPlausibleCoord(lat, lng)) return null;
  // Already on roster (by H02 id or IMEI alias) — not unknown.
  if (resolveRosterEntry(id)) return null;
  // Empty roster is still whitelist-empty: unknowns go to pending, never auto onto overlay.

  const now = Date.now();
  const prev = byId.get(id);
  const next: DiscoveredDevice = prev
    ? {
        ...prev,
        hits: prev.hits + 1,
        last_seen_ms: now,
        last_lat: lat,
        last_lng: lng,
        origin,
        pending: prev.hits + 1 >= MIN_HITS,
      }
    : {
        device_id: id,
        origin,
        hits: 1,
        first_seen_ms: now,
        last_seen_ms: now,
        last_lat: lat,
        last_lng: lng,
        pending: 1 >= MIN_HITS,
      };
  byId.set(id, next);
  if (next.hits === MIN_HITS) {
    console.log(
      `[discovery] pending id=${id} hits=${next.hits} lat=${lat.toFixed(5)} lng=${lng.toFixed(5)}`
    );
  }
  // Persist occasionally
  if (next.hits === 1 || next.hits === MIN_HITS || next.hits % 20 === 0) persist();
  return next;
}

/** Admin list: only threshold-met candidates not already on roster. */
export function listPendingDiscovered(): DiscoveredDevice[] {
  const now = Date.now();
  const out: DiscoveredDevice[] = [];
  for (const d of byId.values()) {
    if (now - d.last_seen_ms > TTL_MS) {
      byId.delete(d.device_id);
      continue;
    }
    if (resolveRosterEntry(d.device_id)) {
      byId.delete(d.device_id);
      continue;
    }
    if (d.hits >= MIN_HITS) out.push({ ...d, pending: true });
  }
  out.sort((a, b) => b.last_seen_ms - a.last_seen_ms);
  return out;
}

export function dismissDiscovered(deviceId: string): DiscoveredDevice[] {
  byId.delete(String(deviceId ?? "").trim());
  persist();
  return listPendingDiscovered();
}

export function clearDiscoveredOnRoster(deviceId: string) {
  byId.delete(String(deviceId ?? "").trim());
  persist();
}
