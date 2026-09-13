import "maplibre-gl/dist/maplibre-gl.css";
import { connectOverlayWs, type OverlayState, type Participant, type TrailPoint } from "./ws";

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
const liveBadgeEl = document.querySelector("#live-badge") as HTMLElement;
const playbackBar = document.querySelector("#playback-bar") as HTMLElement;
const pbToggle = document.querySelector("#pb-toggle") as HTMLButtonElement | null;
const pbScrub = document.querySelector("#pb-scrub") as HTMLInputElement | null;
const pbTime = document.querySelector("#pb-time") as HTMLElement | null;
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
      const isLbs =
        p.athlete?.source === "lbs" &&
        Number.isFinite(p.athlete.lat) &&
        Math.abs(p.athlete.lat) + Math.abs(p.athlete.lng) > 1e-6;
      if (isLbs) {
        parts.push(
          `<span class="online lbs" title="LBS粗定位"></span><span class="lbs-tag">LBS</span>`
        );
      } else {
        const st = p.fix_status ?? (p.online ? "online_no_fix" : "offline");
        const cls =
          st === "fixing" ? "fixing" : st === "online_no_fix" ? "no-fix" : "off";
        const title =
          st === "fixing" ? "定位中" : st === "online_no_fix" ? "在线·无定位" : "离线";
        parts.push(`<span class="online ${cls}" title="${title}"></span>`);
      }
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


type PlaybackState = {
  playing: boolean;
  speed: number;
  /** ms along session [t0, t1] */
  cursorMs: number;
  t0: number;
  t1: number;
  lastFrameMs: number;
  raf: number;
};

let playback: PlaybackState | null = null;

function sessionStatus(state: OverlayState) {
  return state.session?.status || "idle";
}

function collectSessionRange(state: OverlayState): { t0: number; t1: number } | null {
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const p of Object.values(state.participants)) {
    for (const pt of p.trail || []) {
      if (typeof pt.ts !== "number") continue;
      if (pt.ts < t0) t0 = pt.ts;
      if (pt.ts > t1) t1 = pt.ts;
    }
  }
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null;
  return { t0, t1 };
}

function interpTrail(trail: TrailPoint[], t: number): { lat: number; lng: number } | null {
  if (!trail?.length) return null;
  if (t <= trail[0]!.ts) return { lat: trail[0]!.lat, lng: trail[0]!.lng };
  const last = trail[trail.length - 1]!;
  if (t >= last.ts) return { lat: last.lat, lng: last.lng };
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1]!;
    const b = trail[i]!;
    if (t <= b.ts) {
      const span = Math.max(1, b.ts - a.ts);
      const u = (t - a.ts) / span;
      return {
        lat: a.lat + (b.lat - a.lat) * u,
        lng: a.lng + (b.lng - a.lng) * u,
      };
    }
  }
  return { lat: last.lat, lng: last.lng };
}

function formatPbTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ":" + String(r).padStart(2, "0");
}

function ensurePlayback(state: OverlayState) {
  const range = collectSessionRange(state);
  if (!range) {
    playback = null;
    return;
  }
  if (!playback || playback.t0 !== range.t0 || playback.t1 !== range.t1) {
    playback = {
      playing: false,
      speed: playback?.speed || 1,
      cursorMs: range.t0,
      t0: range.t0,
      t1: range.t1,
      lastFrameMs: performance.now(),
      raf: 0,
    };
  }
}

function stopPlaybackRaf() {
  if (playback?.raf) {
    cancelAnimationFrame(playback.raf);
    playback.raf = 0;
  }
}

function playbackTick(now: number) {
  if (!playback || !playback.playing) return;
  const dt = now - playback.lastFrameMs;
  playback.lastFrameMs = now;
  playback.cursorMs = Math.min(
    playback.t1,
    playback.cursorMs + dt * playback.speed
  );
  if (playback.cursorMs >= playback.t1) {
    playback.playing = false;
    if (pbToggle) pbToggle.textContent = "播放";
  }
  syncPlaybackUi();
  render();
  if (playback.playing) {
    playback.raf = requestAnimationFrame(playbackTick);
  }
}

function syncPlaybackUi() {
  if (!playback) return;
  const span = Math.max(1, playback.t1 - playback.t0);
  if (pbScrub) {
    pbScrub.value = String(Math.round(((playback.cursorMs - playback.t0) / span) * 1000));
  }
  if (pbTime) pbTime.textContent = formatPbTime(playback.cursorMs - playback.t0);
  if (pbToggle) pbToggle.textContent = playback.playing ? "暂停" : "播放";
}

function updateLiveBadge(state: OverlayState) {
  const st = sessionStatus(state);
  if (!liveBadgeEl) return;
  liveBadgeEl.classList.remove("show", "replay");
  if (st === "live") {
    liveBadgeEl.textContent = "LIVE";
    liveBadgeEl.classList.add("show");
  } else if (st === "ended") {
    liveBadgeEl.textContent = "REPLAY";
    liveBadgeEl.classList.add("show", "replay");
  }
}


function render() {
  const state = latest;
  const st = sessionStatus(state);
  eventNameEl.textContent = state.session?.event_name || state.event?.name || "Race Live";
  updateLiveBadge(state);

  if (st === "ended") {
    ensurePlayback(state);
    playbackBar?.classList.add("show");
    syncPlaybackUi();
  } else {
    stopPlaybackRaf();
    playback = null;
    playbackBar?.classList.remove("show");
  }

  selectedId = resolveSelection(state);
  const participants = Object.values(state.participants);
  renderList(participants, selectedId, state);

  let positionOverrides: Record<string, { lat: number; lng: number }> | undefined;
  let hudParticipant: Participant | null = selectedId ? state.participants[selectedId] ?? null : null;

  if (st === "ended" && playback) {
    positionOverrides = {};
    for (const p of participants) {
      const pos = interpTrail(p.trail || [], playback.cursorMs);
      if (pos) positionOverrides[p.id] = pos;
    }
    if (hudParticipant && positionOverrides[hudParticipant.id]) {
      const pos = positionOverrides[hudParticipant.id]!;
      hudParticipant = {
        ...hudParticipant,
        athlete: { ...hudParticipant.athlete, lat: pos.lat, lng: pos.lng, speed: 0 },
      };
    }
  }

  renderHud(hudParticipant);
  const mapState = stylePinnedByHash
    ? { ...state, mapStyle: undefined }
    : state;
  map.update(mapState, {
    selectedId,
    follow: st !== "ended",
    hideNonSelected: params.hideNonSelected,
    courseOverride: state.course ?? courseOverride,
    showTrails: st === "live" || st === "ended",
    positionOverrides,
  });
}

connectOverlayWs(params.ws, (state) => {
  latest = state;
  render();
});


pbToggle?.addEventListener("click", () => {
  if (!playback) return;
  playback.playing = !playback.playing;
  playback.lastFrameMs = performance.now();
  if (playback.playing) {
    stopPlaybackRaf();
    playback.raf = requestAnimationFrame(playbackTick);
  } else {
    stopPlaybackRaf();
  }
  syncPlaybackUi();
});

pbScrub?.addEventListener("input", () => {
  if (!playback || !pbScrub) return;
  const span = Math.max(1, playback.t1 - playback.t0);
  playback.cursorMs = playback.t0 + (Number(pbScrub.value) / 1000) * span;
  playback.playing = false;
  stopPlaybackRaf();
  syncPlaybackUi();
  render();
});

document.querySelectorAll(".pb-speed").forEach((btn) => {
  btn.addEventListener("click", () => {
    const speed = Number((btn as HTMLElement).getAttribute("data-speed") || "1");
    if (playback) playback.speed = speed;
    document.querySelectorAll(".pb-speed").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

