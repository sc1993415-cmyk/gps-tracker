import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type MapStyleId = "positron" | "liberty";

export const MAP_STYLES: Record<MapStyleId, { id: MapStyleId; label: string; url: string }> = {
  positron: {
    id: "positron",
    label: "Positron（浅底）",
    url: "https://tiles.openfreemap.org/styles/positron",
  },
  liberty: {
    id: "liberty",
    label: "Liberty（路网）",
    url: "https://tiles.openfreemap.org/styles/liberty",
  },
};

export const DEFAULT_MAP_STYLE: MapStyleId = "positron";

export type MapStyleConfig = {
  id: MapStyleId;
  url: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MAP_STYLE_PATH = path.resolve(__dirname, "../data/map-style.json");

let current: MapStyleConfig = {
  id: DEFAULT_MAP_STYLE,
  url: MAP_STYLES[DEFAULT_MAP_STYLE].url,
};
let onChange: ((c: MapStyleConfig) => void) | null = null;

function normalizeId(raw: unknown): MapStyleId {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "liberty") return "liberty";
  return "positron";
}

export function getMapStyle(): MapStyleConfig {
  return { ...current };
}

export function listMapStyles() {
  return Object.values(MAP_STYLES);
}

export function setMapStyleReloadHandler(fn: (() => void) | null) {
  onChange = fn ? () => fn() : null;
}

export function loadMapStyle(): MapStyleConfig {
  try {
    fs.mkdirSync(path.dirname(MAP_STYLE_PATH), { recursive: true });
    if (!fs.existsSync(MAP_STYLE_PATH)) {
      saveMapStyle(DEFAULT_MAP_STYLE);
      return getMapStyle();
    }
    const parsed = JSON.parse(fs.readFileSync(MAP_STYLE_PATH, "utf8") || "{}") as {
      id?: string;
      url?: string;
    };
    const id = normalizeId(parsed.id);
    current = { id, url: MAP_STYLES[id].url };
    console.log(`[map-style] loaded id=${current.id}`);
    return getMapStyle();
  } catch (err) {
    console.warn("[map-style] load failed, using positron:", err);
    current = { id: DEFAULT_MAP_STYLE, url: MAP_STYLES.positron.url };
    return getMapStyle();
  }
}

export function saveMapStyle(idRaw: unknown): MapStyleConfig {
  const id = normalizeId(idRaw);
  current = { id, url: MAP_STYLES[id].url };
  fs.mkdirSync(path.dirname(MAP_STYLE_PATH), { recursive: true });
  fs.writeFileSync(
    MAP_STYLE_PATH,
    JSON.stringify({ id: current.id, url: current.url }, null, 2) + "\n",
    "utf8"
  );
  console.log(`[map-style] saved id=${current.id}`);
  onChange?.();
  return getMapStyle();
}
