/**
 * Course dead-reckoning when GPS is lost (tunnel / indoor fade).
 * Advances along the GPX by last on-course speed. Does nothing if last speed
 * is below COAST_MIN_KMH (stationary indoor should stay put).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CourseIndex } from "course-project";
import { pointAtS } from "course-project";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const COAST_PATH = path.resolve(__dirname, "../data/coast.json");

export const COAST_MIN_KMH = Number(process.env.GPS_COAST_MIN_KMH) || 8;
export const COAST_MAX_MS = Number(process.env.GPS_COAST_MAX_MS) || 600_000;
export const COAST_TICK_MS = Number(process.env.GPS_COAST_TICK_MS) || 1000;

/** Default OFF: lose-GPS stays on LBS until admin enables coast. */
let enabled = false;
let onChange: (() => void) | null = null;

export type OnCourseFix = {
  s: number;
  lap: number;
  speedMps: number;
  recvMs: number;
};

export type CoastStep = {
  lat: number;
  lng: number;
  s: number;
  lap: number;
  speedKmh: number;
  coastedM: number;
  elapsedMs: number;
};

const lastGood = new Map<string, OnCourseFix>();
const coastFrom = new Map<string, { startedMs: number; originS: number }>();

export function loadCoastConfig() {
  try {
    if (!fs.existsSync(COAST_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(COAST_PATH, "utf8") || "{}");
    if (typeof raw.enabled === "boolean") enabled = raw.enabled;
    console.log(`[coast] loaded enabled=${enabled}`);
  } catch (err) {
    console.warn("[coast] load failed:", err);
  }
}

export function isCoastEnabled() {
  return enabled;
}

export function getCoastConfig() {
  return {
    enabled,
    minKmh: COAST_MIN_KMH,
    maxMs: COAST_MAX_MS,
  };
}

export function setCoastReloadHandler(fn: (() => void) | null) {
  onChange = fn;
}

export function setCoastEnabled(next: boolean) {
  enabled = !!next;
  if (!enabled) coastFrom.clear();
  try {
    fs.mkdirSync(path.dirname(COAST_PATH), { recursive: true });
    fs.writeFileSync(
      COAST_PATH,
      JSON.stringify({ enabled }, null, 2) + "\n",
      "utf8"
    );
  } catch (err) {
    console.warn("[coast] save failed:", err);
  }
  console.log(`[coast] enabled=${enabled}`);
  onChange?.();
  return getCoastConfig();
}

export function noteOnCourseGps(
  deviceId: string,
  s: number,
  lap: number,
  speedKmh: number,
  recvMs = Date.now()
) {
  const speedMps = Math.max(0, Number(speedKmh) || 0) / 3.6;
  lastGood.set(deviceId, { s, lap, speedMps, recvMs });
  coastFrom.delete(deviceId);
}

export function clearCoast(deviceId: string) {
  coastFrom.delete(deviceId);
}

export function hasCoastable(deviceId: string, now = Date.now()): boolean {
  if (!enabled) return false;
  const g = lastGood.get(deviceId);
  if (!g) return false;
  if (g.speedMps * 3.6 < COAST_MIN_KMH) return false;
  if (now - g.recvMs > COAST_MAX_MS) return false;
  return true;
}

export function stepCoast(
  deviceId: string,
  course: CourseIndex | null,
  now = Date.now()
): CoastStep | null {
  if (!enabled) return null;
  if (!course || course.points.length < 2) return null;
  const g = lastGood.get(deviceId);
  if (!g) return null;
  if (g.speedMps * 3.6 < COAST_MIN_KMH) return null;
  if (!coastFrom.has(deviceId)) {
    coastFrom.set(deviceId, { startedMs: g.recvMs, originS: g.s });
  }
  const origin = coastFrom.get(deviceId)!;
  const elapsedMs = now - origin.startedMs;
  if (elapsedMs < 0 || elapsedMs > COAST_MAX_MS) return null;
  const coastedM = g.speedMps * (elapsedMs / 1000);
  const total = course.totalM || 1;
  const raw = origin.originS + coastedM;
  const lapAdd = Math.floor(raw / total);
  const s = raw - lapAdd * total;
  const pt = pointAtS(course, s);
  lastGood.set(deviceId, { ...g, s, lap: g.lap + lapAdd, recvMs: now });
  return {
    lat: pt.lat,
    lng: pt.lng,
    s,
    lap: g.lap + lapAdd,
    speedKmh: Math.round(g.speedMps * 3.6 * 10) / 10,
    coastedM,
    elapsedMs,
  };
}

export function activeCoastIds(now = Date.now()): string[] {
  if (!enabled) return [];
  const ids: string[] = [];
  for (const id of coastFrom.keys()) {
    if (hasCoastable(id, now)) ids.push(id);
  }
  return ids;
}
