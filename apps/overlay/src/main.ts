import "maplibre-gl/dist/maplibre-gl.css";
import { connectOverlayWs, type OverlayState, type Participant } from "./ws";
import { createMap } from "./map";
import { loadCourse, DEMO_COURSE } from "./course";
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
  return {
    selected: q.get("selected"),
    selectedStartNumber: q.get("selectedStartNumber") || q.get("startNumber"),
    largeMode: truthy("largeMode"),
    mapOnly: truthy("mapOnly"),
    hideNonSelected: truthy("hideNonSelected"),
    listOpen: falsy("listOpen") ? false : true,
    ws: q.get("ws") || "ws://localhost:8787",
  };
}

const params = parseParams();
const map = createMap("map");

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
let courseOverride: CourseFeature | null = DEMO_COURSE;
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
    else if (typeof v === "string" && k === "ws" && v !== "ws://localhost:8787") h.set(k, v);
  }
  history.replaceState(null, "", "#" + h.toString());
  render();
}

function renderList(participants: Participant[], selected: string | null) {
  const sorted = [...participants].sort((a, b) =>
    a.bib.localeCompare(b.bib, undefined, { numeric: true })
  );
  listEl.innerHTML = "";
  for (const p of sorted) {
    const km = (p.athlete.distance / 1000).toFixed(2);
    const li = document.createElement("button");
    li.type = "button";
    li.className = "participant-item" + (p.id === selected ? " active" : "");
    li.innerHTML = `
      <span class="dot" style="background:${p.color || "#ff3b5c"}"></span>
      <span class="bib">${escapeHtml(p.bib || "—")}</span>
      <span class="name">${escapeHtml(shortName(p.name))}</span>
      <span class="progress">${km} km</span>
      <span class="online ${p.online ? "on" : "off"}"></span>
    `;
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
  eventNameEl.textContent = state.event?.name || "Live";
  selectedId = resolveSelection(state);
  const participants = Object.values(state.participants);
  renderList(participants, selectedId);
  const sel = selectedId ? state.participants[selectedId] ?? null : null;
  renderHud(sel);
  map.update(state, {
    selectedId,
    follow: true,
    hideNonSelected: params.hideNonSelected,
    courseOverride,
  });
}

connectOverlayWs(params.ws, (state) => {
  latest = state;
  render();
});
