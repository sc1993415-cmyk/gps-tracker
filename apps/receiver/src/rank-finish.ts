import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RANK_FINISH_PATH = path.resolve(__dirname, "../data/rank-finish.json");

let enabled = false;
let onChange: (() => void) | null = null;

export function loadRankFinishConfig() {
  try {
    if (!fs.existsSync(RANK_FINISH_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(RANK_FINISH_PATH, "utf8") || "{}");
    if (typeof raw.enabled === "boolean") enabled = raw.enabled;
    console.log(`[rank-finish] loaded enabled=${enabled}`);
  } catch (err) {
    console.warn("[rank-finish] load failed", err);
  }
}

export function getRankFinishConfig() {
  return { enabled };
}

export function isRankFinishEnabled() {
  return enabled;
}

export function setRankFinishReloadHandler(fn: (() => void) | null) {
  onChange = fn;
}

export function setRankFinishEnabled(next: boolean) {
  enabled = !!next;
  try {
    fs.mkdirSync(path.dirname(RANK_FINISH_PATH), { recursive: true });
    fs.writeFileSync(RANK_FINISH_PATH, JSON.stringify({ enabled }, null, 2) + "\n");
  } catch (err) {
    console.warn("[rank-finish] save failed", err);
  }
  console.log(`[rank-finish] enabled=${enabled}`);
  onChange?.();
  return getRankFinishConfig();
}
