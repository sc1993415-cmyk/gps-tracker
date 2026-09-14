import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type HudFieldId =
  | "bib"
  | "name"
  | "nationality"
  | "speed"
  | "distance"
  | "remaining"
  | "pace"
  | "climb";

export const HUD_FIELD_IDS: HudFieldId[] = [
  "bib",
  "name",
  "nationality",
  "speed",
  "distance",
  "remaining",
  "pace",
  "climb",
];

export const HUD_FIELD_LABELS: Record<HudFieldId, string> = {
  bib: "选手号牌",
  name: "姓名",
  nationality: "国籍（国旗）",
  speed: "当前时速",
  distance: "已过里程",
  remaining: "剩余里程",
  pace: "配速",
  climb: "累计爬升",
};

export const DEFAULT_HUD_FIELDS: Record<HudFieldId, boolean> = {
  bib: true,
  name: true,
  nationality: true,
  speed: true,
  distance: true,
  remaining: true,
  pace: true,
  climb: true,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const HUD_FIELDS_PATH = path.resolve(__dirname, "../data/hud-fields.json");

let current: Record<HudFieldId, boolean> = { ...DEFAULT_HUD_FIELDS };
let onChange: (() => void) | null = null;

function normalize(raw: unknown): Record<HudFieldId, boolean> {
  const out: Record<HudFieldId, boolean> = { ...DEFAULT_HUD_FIELDS };
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;
  const arr = Array.isArray(o.hudFields)
    ? o.hudFields
    : Array.isArray(raw)
      ? (raw as unknown[])
      : null;
  if (arr) {
    for (const id of HUD_FIELD_IDS) out[id] = false;
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const e = item as { id?: string; enabled?: boolean };
      const id = String(e.id ?? "") as HudFieldId;
      if (HUD_FIELD_IDS.includes(id)) out[id] = e.enabled !== false;
    }
    return out;
  }
  const cols = o.fields && typeof o.fields === "object" ? (o.fields as Record<string, unknown>) : o;
  for (const id of HUD_FIELD_IDS) {
    if (id in cols) out[id] = Boolean(cols[id]);
  }
  return out;
}

export function loadHudFields() {
  try {
    if (fs.existsSync(HUD_FIELDS_PATH)) {
      current = normalize(JSON.parse(fs.readFileSync(HUD_FIELDS_PATH, "utf8") || "{}"));
    }
    console.log(
      `[hud-fields] loaded enabled=${HUD_FIELD_IDS.filter((id) => current[id]).join(",")}`
    );
  } catch (err) {
    console.warn("[hud-fields] load failed", err);
  }
}

export function getHudFields() {
  return HUD_FIELD_IDS.map((id) => ({
    id,
    enabled: current[id] !== false,
    label: HUD_FIELD_LABELS[id],
  }));
}

export function getHudFieldsConfig() {
  return { hudFields: getHudFields() };
}

export function setHudFieldsReloadHandler(fn: (() => void) | null) {
  onChange = fn;
}

export function setHudFields(raw: unknown) {
  current = normalize(raw);
  try {
    fs.mkdirSync(path.dirname(HUD_FIELDS_PATH), { recursive: true });
    fs.writeFileSync(
      HUD_FIELDS_PATH,
      JSON.stringify({ fields: current }, null, 2) + "\n"
    );
  } catch (err) {
    console.warn("[hud-fields] save failed", err);
  }
  console.log(
    `[hud-fields] saved enabled=${HUD_FIELD_IDS.filter((id) => current[id]).join(",")}`
  );
  onChange?.();
  return getHudFieldsConfig();
}
