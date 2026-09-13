import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type RosterEntry = {
  device_id: string;
  /** Optional IMEI alias — packets still use H02 device_id; match either. */
  imei?: string;
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
  const imei = String(o.imei ?? "").trim();
  return {
    device_id,
    ...(imei ? { imei } : {}),
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

/** Match H02 device_id or optional IMEI alias. */
export function resolveRosterEntry(id: string): RosterEntry | undefined {
  const key = String(id ?? "").trim();
  if (!key) return undefined;
  const direct = rosterByDevice.get(key);
  if (direct) return direct;
  for (const e of rosterByDevice.values()) {
    if (e.imei && e.imei === key) return e;
  }
  return undefined;
}

/** Persist full roster and hot-reload in memory. */
export function saveRoster(entries: unknown[]): RosterEntry[] {
  const list = entries.map(normalizeEntry).filter((e): e is RosterEntry => !!e);
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

export function setRosterReloadHandler(fn: () => void) {
  onReload = fn;
}

/** CSV: device_id,imei,bib,name,color */
export function rosterToCsv(entries = getRoster()): string {
  const esc = (s: string) => {
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = ["device_id,imei,bib,name,color"];
  for (const e of entries) {
    lines.push(
      [e.device_id, e.imei || "", e.bib || "", e.name || "", e.color || ""].map(esc).join(",")
    );
  }
  return lines.join("\n") + "\n";
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Replace or merge roster from CSV text. mode: replace | merge */
export function importRosterCsv(
  text: string,
  mode: "replace" | "merge" = "merge"
): RosterEntry[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error("empty CSV");
  const header = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iId = idx("device_id");
  if (iId < 0) throw new Error("CSV must include device_id column");
  const iImei = idx("imei");
  const iBib = idx("bib");
  const iName = idx("name");
  const iColor = idx("color");
  const rows: RosterEntry[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = parseCsvLine(lines[r]!);
    const device_id = (cols[iId] || "").trim();
    if (!device_id) continue;
    rows.push({
      device_id,
      ...(iImei >= 0 && cols[iImei]?.trim() ? { imei: cols[iImei]!.trim() } : {}),
      bib: iBib >= 0 ? (cols[iBib] || "").trim() : "",
      name: iName >= 0 ? (cols[iName] || "").trim() || device_id : device_id,
      color: iColor >= 0 ? (cols[iColor] || "").trim() || "#ff3b5c" : "#ff3b5c",
    });
  }
  if (mode === "replace") return saveRoster(rows);
  return upsertRoster(rows);
}
