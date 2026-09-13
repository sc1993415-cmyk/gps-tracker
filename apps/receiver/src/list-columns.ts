import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ListColumnId =
  | "bib"
  | "name"
  | "progress"
  | "speed"
  | "battery"
  | "online"
  | "lastUpdate"
  | "offCourse";

export const LIST_COLUMN_IDS: ListColumnId[] = [
  "bib",
  "name",
  "progress",
  "speed",
  "battery",
  "online",
  "lastUpdate",
  "offCourse",
];

export const LIST_COLUMN_LABELS: Record<ListColumnId, string> = {
  bib: "号码牌",
  name: "姓名",
  progress: "进度",
  speed: "速度",
  battery: "电量",
  online: "在线",
  lastUpdate: "更新时间",
  offCourse: "偏航",
};

/** Default enabled: bib, name, progress, online, battery */
export const DEFAULT_LIST_COLUMNS: Record<ListColumnId, boolean> = {
  bib: true,
  name: true,
  progress: true,
  speed: false,
  battery: true,
  online: true,
  lastUpdate: false,
  offCourse: false,
};

export type ListColumnEntry = { id: ListColumnId; enabled: boolean; label: string };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LIST_COLUMNS_PATH = path.resolve(__dirname, "../data/list-columns.json");

let current: Record<ListColumnId, boolean> = { ...DEFAULT_LIST_COLUMNS };
let onChange: (() => void) | null = null;

function normalize(raw: unknown): Record<ListColumnId, boolean> {
  const out: Record<ListColumnId, boolean> = { ...DEFAULT_LIST_COLUMNS };
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;

  // Shape A: { columns: Record<string,boolean> }
  const cols =
    o.columns && typeof o.columns === "object"
      ? (o.columns as Record<string, unknown>)
      : o;

  // Shape B: { listColumns: [{id, enabled}] } or top-level array
  const arr = Array.isArray(o.listColumns)
    ? o.listColumns
    : Array.isArray(raw)
      ? (raw as unknown[])
      : null;

  if (arr) {
    for (const id of LIST_COLUMN_IDS) out[id] = false;
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const e = item as { id?: string; enabled?: boolean };
      const id = String(e.id ?? "") as ListColumnId;
      if (LIST_COLUMN_IDS.includes(id)) out[id] = e.enabled !== false;
    }
    return out;
  }

  for (const id of LIST_COLUMN_IDS) {
    if (id in cols) out[id] = Boolean(cols[id]);
  }
  return out;
}

export function getListColumns(): ListColumnEntry[] {
  return LIST_COLUMN_IDS.map((id) => ({
    id,
    enabled: current[id] !== false,
    label: LIST_COLUMN_LABELS[id],
  }));
}

export function getListColumnsMap(): Record<ListColumnId, boolean> {
  return { ...current };
}

export function setListColumnsReloadHandler(fn: (() => void) | null) {
  onChange = fn;
}

export function loadListColumns(): ListColumnEntry[] {
  try {
    fs.mkdirSync(path.dirname(LIST_COLUMNS_PATH), { recursive: true });
    if (!fs.existsSync(LIST_COLUMNS_PATH)) {
      saveListColumns(DEFAULT_LIST_COLUMNS);
      return getListColumns();
    }
    const parsed = JSON.parse(fs.readFileSync(LIST_COLUMNS_PATH, "utf8") || "{}");
    current = normalize(parsed);
    console.log(
      `[list-columns] loaded enabled=${LIST_COLUMN_IDS.filter((id) => current[id]).join(",")}`
    );
    return getListColumns();
  } catch (err) {
    console.warn("[list-columns] load failed, using defaults:", err);
    current = { ...DEFAULT_LIST_COLUMNS };
    return getListColumns();
  }
}

export function saveListColumns(raw: unknown): ListColumnEntry[] {
  current = normalize(raw);
  fs.mkdirSync(path.dirname(LIST_COLUMNS_PATH), { recursive: true });
  const payload = {
    columns: getListColumnsMap(),
    listColumns: getListColumns().map(({ id, enabled }) => ({ id, enabled })),
  };
  fs.writeFileSync(LIST_COLUMNS_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(
    `[list-columns] saved enabled=${LIST_COLUMN_IDS.filter((id) => current[id]).join(",")}`
  );
  onChange?.();
  return getListColumns();
}
