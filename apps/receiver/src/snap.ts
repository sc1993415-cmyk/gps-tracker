import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SNAP_PATH = path.resolve(__dirname, "../data/snap.json");

/** Default ON: RaceMap-style snap to GPX when within ~100m. */
let enabled = true;
let onChange: (() => void) | null = null;

export function loadSnapConfig() {
  try {
    if (!fs.existsSync(SNAP_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(SNAP_PATH, "utf8") || "{}");
    if (typeof raw.enabled === "boolean") enabled = raw.enabled;
    console.log(`[snap] loaded enabled=${enabled}`);
  } catch (err) {
    console.warn("[snap] load failed:", err);
  }
}

export function isSnapEnabled() {
  return enabled;
}

export function getSnapConfig() {
  return { enabled, maxMapM: Number(process.env.GPS_SNAP_MAX_M) || 100 };
}

export function setSnapReloadHandler(fn: (() => void) | null) {
  onChange = fn;
}

export function setSnapEnabled(next: boolean) {
  enabled = !!next;
  try {
    fs.mkdirSync(path.dirname(SNAP_PATH), { recursive: true });
    fs.writeFileSync(
      SNAP_PATH,
      JSON.stringify({ enabled }, null, 2) + "\n",
      "utf8"
    );
  } catch (err) {
    console.warn("[snap] save failed:", err);
  }
  console.log(`[snap] enabled=${enabled}`);
  onChange?.();
  return getSnapConfig();
}
