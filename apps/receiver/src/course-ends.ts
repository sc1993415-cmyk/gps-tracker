import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const COURSE_ENDS_PATH = path.resolve(__dirname, "../data/course-ends.json");

let enabled = true;
let onChange: (() => void) | null = null;

export function loadCourseEndsConfig() {
  try {
    if (!fs.existsSync(COURSE_ENDS_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(COURSE_ENDS_PATH, "utf8") || "{}");
    if (typeof raw.enabled === "boolean") enabled = raw.enabled;
    console.log(`[course-ends] loaded enabled=${enabled}`);
  } catch (err) {
    console.warn("[course-ends] load failed", err);
  }
}

export function getCourseEndsConfig() {
  return { enabled };
}

export function isCourseEndsEnabled() {
  return enabled;
}

export function setCourseEndsReloadHandler(fn: (() => void) | null) {
  onChange = fn;
}

export function setCourseEndsEnabled(next: boolean) {
  enabled = !!next;
  try {
    fs.mkdirSync(path.dirname(COURSE_ENDS_PATH), { recursive: true });
    fs.writeFileSync(COURSE_ENDS_PATH, JSON.stringify({ enabled }, null, 2) + "\n");
  } catch (err) {
    console.warn("[course-ends] save failed", err);
  }
  console.log(`[course-ends] enabled=${enabled}`);
  onChange?.();
  return getCourseEndsConfig();
}
