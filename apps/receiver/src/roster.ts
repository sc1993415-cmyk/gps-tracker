import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type RosterEntry = {
  device_id: string;
  bib: string;
  name: string;
  color: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROSTER_PATH = path.resolve(__dirname, "../data/roster.json");

let rosterByDevice = new Map<string, RosterEntry>();
let onReload: (() => void) | null = null;

function normalizeEntry(raw: unknown): RosterEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const device_id = String(o.device_id ?? "").trim();
  if (!device_id) return null;
  return {
    device_id,
    bib: String(o.bib ?? "").trim(),
    name: String(o.name ?? "").trim() || device_id,
    color: String(o.color ?? "").trim() || "#ff3b5c",
  };
}

function applyList(list: RosterEntry[]) {
  const next = new Map<string, RosterEntry>();
  for (const e of list) next.set(e.device_id, e);
  rosterByDevice = next;
}

/** Load roster.json from disk (creates empty array file if missing). */
export function loadRoster(): RosterEntry[] {
  try {
    fs.mkdirSync(path.dirname(ROSTER_PATH), { recursive: true });
    if (!fs.existsSync(ROSTER_PATH)) {
      fs.writeFileSync(ROSTER_PATH, "[]\n", "utf8");
      applyList([]);
      return [];
    }
    const text = fs.readFileSync(ROSTER_PATH, "utf8");
    const parsed = JSON.parse(text || "[]") as unknown;
    if (!Array.isArray(parsed)) throw new Error("roster.json must be an array");
    const list = parsed.map(normalizeEntry).filter((e): e is RosterEntry => !!e);
    applyList(list);
    console.log(`[roster] loaded ${list.length} entr${list.length === 1 ? "y" : "ies"} from ${ROSTER_PATH}`);
    return list;
  } catch (err) {
    console.warn("[roster] load failed, using empty roster:", err);
    applyList([]);
    return [];
  }
}

export function getRoster(): RosterEntry[] {
  return [...rosterByDevice.values()];
}

export function getRosterEntry(deviceId: string): RosterEntry | undefined {
  return rosterByDevice.get(deviceId);
}

/** Persist full roster and hot-reload in memory. */
export function saveRoster(entries: unknown[]): RosterEntry[] {
  const list = entries.map(normalizeEntry).filter((e): e is RosterEntry => !!e);
  // Dedupe by device_id (last wins)
  const map = new Map<string, RosterEntry>();
  for (const e of list) map.set(e.device_id, e);
  const unique = [...map.values()];
  fs.mkdirSync(path.dirname(ROSTER_PATH), { recursive: true });
  fs.writeFileSync(ROSTER_PATH, JSON.stringify(unique, null, 2) + "\n", "utf8");
  applyList(unique);
  console.log(`[roster] saved ${unique.length} entr${unique.length === 1 ? "y" : "ies"}`);
  onReload?.();
  return unique;
}

/** Upsert one or more entries, then persist. */
export function upsertRoster(entries: unknown[]): RosterEntry[] {
  const current = new Map(rosterByDevice);
  for (const raw of entries) {
    const e = normalizeEntry(raw);
    if (e) current.set(e.device_id, e);
  }
  return saveRoster([...current.values()]);
}

/** Delete by device_id, then persist. */
export function deleteRosterEntry(deviceId: string): RosterEntry[] {
  const id = String(deviceId ?? "").trim();
  const current = [...rosterByDevice.values()].filter((e) => e.device_id !== id);
  return saveRoster(current);
}

/** Register callback invoked after every successful save/reload. */
export function setRosterReloadHandler(fn: () => void) {
  onReload = fn;
}
