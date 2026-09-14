import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TRAIL_BREAK_PATH = path.resolve(__dirname, "../data/trail-break.json");

const DEFAULT_BREAK_M = Number(process.env.GPS_TRAIL_BREAK_M) || 60;
const MIN_M = 10;
const MAX_M = 5000;

let breakM = DEFAULT_BREAK_M;
let onChange: (() => void) | null = null;

function clampM(n: number) {
  if (!Number.isFinite(n)) return DEFAULT_BREAK_M;
  return Math.min(MAX_M, Math.max(MIN_M, Math.round(n)));
}

export function loadTrailBreakConfig() {
  try {
    if (!fs.existsSync(TRAIL_BREAK_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(TRAIL_BREAK_PATH, "utf8") || "{}");
    if (typeof raw.breakM === "number") breakM = clampM(raw.breakM);
    console.log(`[trail-break] loaded breakM=${breakM}`);
  } catch (err) {
    console.warn("[trail-break] load failed:", err);
  }
}

export function getTrailBreakM() {
  return breakM;
}

export function getTrailBreakConfig() {
  return { breakM, minM: MIN_M, maxM: MAX_M };
}

export function setTrailBreakReloadHandler(fn: (() => void) | null) {
  onChange = fn;
}

export function setTrailBreakM(next: number) {
  breakM = clampM(next);
  try {
    fs.mkdirSync(path.dirname(TRAIL_BREAK_PATH), { recursive: true });
    fs.writeFileSync(
      TRAIL_BREAK_PATH,
      JSON.stringify({ breakM }, null, 2) + "\n",
      "utf8"
    );
  } catch (err) {
    console.warn("[trail-break] save failed:", err);
  }
  console.log(`[trail-break] breakM=${breakM}`);
  onChange?.();
  return getTrailBreakConfig();
}
