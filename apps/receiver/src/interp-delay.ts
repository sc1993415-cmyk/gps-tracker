import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const INTERP_DELAY_PATH = path.resolve(__dirname, "../data/interp-delay.json");

/** Default ON: high-speed overlay stays one packet behind. */
let enabled = true;
let onChange: (() => void) | null = null;

export function loadInterpDelayConfig() {
  try {
    if (!fs.existsSync(INTERP_DELAY_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(INTERP_DELAY_PATH, "utf8") || "{}");
    if (typeof raw.enabled === "boolean") enabled = raw.enabled;
    console.log(`[interp-delay] loaded enabled=${enabled}`);
  } catch (err) {
    console.warn("[interp-delay] load failed:", err);
  }
}

export function isInterpDelayEnabled() {
  return enabled;
}

export function getInterpDelayConfig() {
  return { enabled };
}

export function setInterpDelayReloadHandler(fn: (() => void) | null) {
  onChange = fn;
}

export function setInterpDelayEnabled(next: boolean) {
  enabled = !!next;
  try {
    fs.mkdirSync(path.dirname(INTERP_DELAY_PATH), { recursive: true });
    fs.writeFileSync(
      INTERP_DELAY_PATH,
      JSON.stringify({ enabled }, null, 2) + "\n",
      "utf8"
    );
  } catch (err) {
    console.warn("[interp-delay] save failed:", err);
  }
  console.log(`[interp-delay] enabled=${enabled}`);
  onChange?.();
  return getInterpDelayConfig();
}
