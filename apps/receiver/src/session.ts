import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SessionStatus = "idle" | "live" | "ended";

export type SessionInfo = {
  status: SessionStatus;
  event_name: string;
  started_ms?: number;
  ended_ms?: number;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EVENT_NAME_PATH = path.resolve(__dirname, "../data/event-name.json");

const DEFAULT_NAME = "Race Live";

let status: SessionStatus = "idle";
let eventName = DEFAULT_NAME;
let startedMs: number | undefined;
let endedMs: number | undefined;
let onChange: (() => void) | null = null;
let clearTrailsFn: (() => void) | null = null;

export function loadEventName() {
  try {
    if (!fs.existsSync(EVENT_NAME_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(EVENT_NAME_PATH, "utf8") || "{}");
    const n = String(raw.name ?? raw.event_name ?? "").trim();
    if (n) eventName = n;
  } catch (err) {
    console.warn("[session] load event name failed:", err);
  }
}

export function setSessionReloadHandler(fn: (() => void) | null) {
  onChange = fn;
}

export function setSessionTrailClearer(fn: (() => void) | null) {
  clearTrailsFn = fn;
}

export function getSession(): SessionInfo {
  return {
    status,
    event_name: eventName,
    started_ms: startedMs,
    ended_ms: endedMs,
  };
}

export function isSessionLive(): boolean {
  return status === "live";
}

export function setEventName(name: string): SessionInfo {
  const n = String(name ?? "").trim() || DEFAULT_NAME;
  eventName = n;
  try {
    fs.mkdirSync(path.dirname(EVENT_NAME_PATH), { recursive: true });
    fs.writeFileSync(
      EVENT_NAME_PATH,
      JSON.stringify({ name: eventName }, null, 2) + "\n",
      "utf8"
    );
  } catch (err) {
    console.warn("[session] save event name failed:", err);
  }
  onChange?.();
  return getSession();
}

export function startSession(): SessionInfo {
  clearTrailsFn?.();
  status = "live";
  startedMs = Date.now();
  endedMs = undefined;
  console.log(`[session] start name=${eventName}`);
  onChange?.();
  return getSession();
}

export function endSession(): SessionInfo {
  if (status === "live") {
    status = "ended";
    endedMs = Date.now();
    console.log(`[session] end duration_s=${((endedMs - (startedMs || endedMs)) / 1000).toFixed(0)}`);
  }
  onChange?.();
  return getSession();
}

/** Clear trails only — caller must wipe participant trails. Status → idle. */
export function resetSession(): SessionInfo {
  clearTrailsFn?.();
  status = "idle";
  startedMs = undefined;
  endedMs = undefined;
  console.log("[session] reset");
  onChange?.();
  return getSession();
}
