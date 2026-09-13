import "maplibre-gl/dist/maplibre-gl.css";
import { connectOverlayWs, type OverlayState, type Participant } from "./ws";

import { createMap, OPENFREEMAP_STYLES } from "./map";
import { loadCourse } from "./course";
import type { CourseFeature } from "./ws";

/** RaceMap-style hash params: #selected=…&mapOnly=true (also accepts ?query for compat). */
function parseParams() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  const q = new URLSearchParams(hash || location.search);
  // Prefer hash; merge search only for keys missing in hash
  if (hash) {
    const search = new URLSearchParams(location.search);
    for (const [k, v] of search) {
      if (!q.has(k)) q.set(k, v);
    }
  }
  const truthy = (k: string) => {
    const v = q.get(k);
    return v === "1" || v === "true" || v === "";
  };
  const falsy = (k: string) => {
    const v = q.get(k);
    return v === "0" || v === "false";
  };
  const styleRaw = (q.get("style") || "").trim().toLowerCase();
  const styleOverride =
    styleRaw === "liberty" || styleRaw === "positron" ? styleRaw : null;
  return {
    selected: q.get("selected"),
    selectedStartNumber: q.get("selectedStartNumber") || q.get("startNumber"),
    largeMode: truthy("largeMode"),
    mapOnly: truthy("mapOnly"),
    hideNonSelected: truthy("hideNonSelected"),
    listOpen: falsy("listOpen") ? false : true,
    ws: q.get("ws") || `ws://${location.hostname}:8787`,
    styleOverride,
  };
}

const params = parseParams();
const hashStyleUrl = params.styleOverride
  ? OPENFREEMAP_STYLES[params.styleOverride]
  : undefined;
const map = createMap("map", hashStyleUrl);
// Hash #style= overrides WS mapStyle for this page load.
const stylePinnedByHash = Boolean(params.styleOverride);

const root = document.documentElement;
if (params.largeMode) root.classList.add("large-mode");
if (params.mapOnly) root.classList.add("map-only");

const eventNameEl = document.querySelector("#event-name")!;
const listEl = document.querySelector("#participant-list")!;
const listPanel = document.querySelector("#list-panel")!;
const toggleBtn = document.querySelector("#list-toggle") as HTMLButtonElement;
const hud = document.querySelector("#hud")!;
const speedEl = document.querySelector("#speed")!;
const distanceEl = document.querySelector("#distance")!;
const climbEl = document.querySelector("#climb")!;

let selectedId: string | null = null;
let latest: OverlayState = { participants: {} };
let courseOverride: CourseFeature | null = null;
let userPicked = false;

if (!params.listOpen) {
  listPanel.classList.add("collapsed");
  if (toggleBtn) toggleBtn.textContent = "›";
}

toggleBtn?.addEventListener("click", () => {
  listPanel.classList.toggle("collapsed");
  toggleBtn.textContent = listPanel.classList.contains("collapsed") ? "›" : "‹";
});

loadCourse().then((c) => {
  courseOverride = c;
  render();
});

window.addEventListener("hashchange", () => {
  const next = parseParams();
  Object.assign(params, next);
  root.classList.toggle("large-mode", next.largeMode);
  root.classList.toggle("map-only", next.mapOnly);
  if (!next.listOpen) {
    listPanel.classList.add("collapsed");
    if (toggleBtn) toggleBtn.textContent = "›";
  } else {
    listPanel.classList.remove("collapsed");
    if (toggleBtn) toggleBtn.textContent = "‹";
  }
  userPicked = false;
  render();
});

function shortName(name: string): string {
  return name.length > 14 ? name.slice(0, 13) + "…" : name;
}

function resolveSelection(state: OverlayState): string | null {
  const list = Object.values(state.participants);
  if (!list.length) return null;

  if (userPicked && selectedId && state.participants[selectedId]) {
    return selectedId;
  }

  if (params.selected && state.participants[params.selected]) {
    return params.selected;
  }

  if (params.selectedStartNumber) {
    const byBib = list.find((p) => p.bib === params.selectedStartNumber);
    if (byBib) return byBib.id;
  }

  if (selectedId && state.participants[selectedId]) return selectedId;
  return list[0]!.id;
}

function selectParticipant(id: string) {
  selectedId = id;
  userPicked = true;
  map.setFollow(true);
  // Reflect selection in hash (RaceMap-style)
  const h = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : "");
  h.set("selected", id);
  const keep = ["mapOnly", "largeMode", "hideNonSelected", "listOpen", "ws"];
  const cur = parseParams();
  for (const k of keep) {
    const v = (cur as Record<string, unknown>)[k];
    if (v === true) h.set(k, "true");
    else if (v === false && k === "listOpen") h.set(k, "false");
    else if (typeof v === "string" && k === "ws" && v !== `ws://${location.hostname}:8787`) h.set(k, v);
  }
  history.replaceState(null, "", "#" + h.toString());
  render();
}

const DEFAULT_LIST_COLS: Record<string, boolean> = {
  bib: true,
  name: true,
  progress: true,
  speed: false,
  battery: true,
  online: true,
  lastUpdate: false,
  offCourse: false,
};

function enabledColumns(state: OverlayState): Record<string, boolean> {
  const out = { ...DEFAULT_LIST_COLS };
  const cols = state.listColumns;
  if (Array.isArray(cols) && cols.length) {
    for (const k of Object.keys(out)) out[k] = false;
    for (const c of cols) {
      if (c && typeof c.id === "string") out[c.id] = c.enabled !== false;
    }
  }
  return out;
}

function formatLastUpdate(ts: number | undefined): string {
  if (!ts || !Number.isFinite(ts)) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function formatBattery(p: Participant): string {
  const pct = p.athlete.battery_pct ?? p.athlete.battery;
  if (typeof pct === "number" && Number.isFinite(pct)) return `${Math.round(pct)}%`;
  if (typeof p.athlete.battery_bars === "number") return `${p.athlete.battery_bars}格`;
  return "—";
}

function renderList(participants: Participant[], selected: string | null, state: OverlayState) {
  const cols = enabledColumns(state);
  const sorted = [...participants].sort((a, b) =>
    a.bib.localeCompare(b.bib, undefined, { numeric: true })
  );
  listEl.innerHTML = "";
  if (!sorted.length) {
    const empty = document.createElement("div");
    empty.className = "participant-item";
    empty.style.cursor = "default";
    empty.style.opacity = "0.55";
    empty.textContent = "暂无选手";
    listEl.appendChild(empty);
    return;
  }
  for (const p of sorted) {
    const meters = typeof p.progress_m === "number" ? p.progress_m : p.athlete.distance;
    const km = (meters / 1000).toFixed(2);
    const speed = Number.isFinite(p.athlete.speed) ? p.athlete.speed.toFixed(1) : "—";
    const parts: string[] = [
      `<span class="dot" style="background:${p.color || "#ff3b5c"}"></span>`,
    ];
    if (cols.bib) parts.push(`<span class="bib">${escapeHtml(p.bib || "—")}</span>`);
    if (cols.name) parts.push(`<span class="name">${escapeHtml(shortName(p.name))}</span>`);
    if (cols.progress) parts.push(`<span class="progress">${km} km</span>`);
    if (cols.speed) parts.push(`<span class="speed">${speed}<small>km/h</small></span>`);
    if (cols.battery) parts.push(`<span class="battery">${escapeHtml(formatBattery(p))}</span>`);
    if (cols.lastUpdate) {
      parts.push(`<span class="lastUpdate">${escapeHtml(formatLastUpdate(p.last_seen_ms ?? p.athlete.ts))}</span>`);
    }
    if (cols.offCourse && p.off_course) {
      parts.push(`<span class="offCourse">偏航</span>`);
    }
    if (cols.online) {
      const st = p.fix_status ?? (p.online ? "online_no_fix" : "offline");
      const cls =
        st === "fixing" ? "fixing" : st === "online_no_fix" ? "no-fix" : "off";
      const title =
        st === "fixing" ? "定位中" : st === "online_no_fix" ? "在线·无定位" : "离线";
      parts.push(`<span class="online ${cls}" title="${title}"></span>`);
    }
    const li = document.createElement("button");
    li.type = "button";
    li.className = "participant-item" + (p.id === selected ? " active" : "");
    li.innerHTML = parts.join("\n      ");
    li.addEventListener("click", () => selectParticipant(p.id));
    listEl.appendChild(li);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHud(p: Participant | null) {
  if (!p) {
    hud.classList.add("hidden");
    return;
  }
  hud.classList.remove("hidden");
  speedEl.textContent = `${p.athlete.speed.toFixed(1)}`;
  distanceEl.textContent = `${(p.athlete.distance / 1000).toFixed(2)}`;
  climbEl.textContent = `${Math.round(p.athlete.climb)}`;
}

function render() {
  const state = latest;
  eventNameEl.textContent = state.event?.name || "直播";
  selectedId = resolveSelection(state);
  const participants = Object.values(state.participants);
  renderList(participants, selectedId, state);
  const sel = selectedId ? state.participants[selectedId] ?? null : null;
  renderHud(sel);
  const mapState = stylePinnedByHash
    ? { ...state, mapStyle: undefined }
    : state;
  map.update(mapState, {
    selectedId,
    follow: true,
    hideNonSelected: params.hideNonSelected,
    // Prefer live WS course (e.g. after admin GPX upload); fall back to /course.geojson.
    courseOverride: state.course ?? courseOverride,
  });
}

connectOverlayWs(params.ws, (state) => {
  latest = state;
  render();
});
