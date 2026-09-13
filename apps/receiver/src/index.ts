import { createWsServer } from "./ws-server.ts";
import { pushTrailPoint } from "./downsample.ts";
import { startDemoPublisher, DEFAULT_ATHLETES } from "./demo-publisher.ts";
import { startH02TcpServer } from "./h02-tcp.ts";
import { startAdminServer } from "./admin-server.ts";
import {
  loadRoster,
  getRoster,
  getRosterEntry,
  resolveRosterEntry,
  setRosterReloadHandler,
} from "./roster.ts";
import {
  loadDiscovery,
  noteUnknownSighting,
  clearDiscoveredOnRoster,
  isPlausibleDeviceId,
} from "./discovery.ts";
import {
  loadMapStyle,
  getMapStyle,
  setMapStyleReloadHandler,
} from "./map-style.ts";
import {
  loadListColumns,
  getListColumns,
  setListColumnsReloadHandler,
} from "./list-columns.ts";
import {
  loadPersistedCourse,
  setCourseUploadHandler,
  type GpxParseResult,
} from "./gpx.ts";
import type { OverlayState, Participant, TrailPoint, CourseFeature } from "./ws-server.ts";
import type { Telemetry } from "../../../packages/schema/src/telemetry.ts";
import {
  buildCourseIndex,
  projectToCourse,
  type CourseIndex,
} from "course-project";
import { checkJump, type AcceptedFix } from "./jump-filter.ts";
import {
  loadEventName,
  getSession,
  isSessionLive,
  setSessionReloadHandler,
  setSessionTrailClearer,
} from "./session.ts";
import {
  loadSnapConfig,
  isSnapEnabled,
  getSnapConfig,
  setSnapReloadHandler,
} from "./snap.ts";
import { isDeviceOnline } from "./device-sessions.ts";

/** No packet / no TCP within this window → offline (covers ~5min standby heartbeat). */
const ONLINE_TIMEOUT_MS = Number(process.env.GPS_ONLINE_TIMEOUT_MS) || 360_000;
/** Recent valid=true within this window → fixing. */
const FIX_FRESH_MS = Number(process.env.GPS_FIX_FRESH_MS) || 30_000;
/** Throttle WS pushes when only presence/last_seen changes. */
const PRESENCE_EMIT_MIN_MS = Number(process.env.GPS_PRESENCE_EMIT_MIN_MS) || 1000;
let lastPresenceEmitMs = 0;

const demo = process.argv.includes("--demo");

const { broadcast } = createWsServer(Number(process.env.WS_PORT) || 8787);

/** Optional static demo course (inline LineString) — overlay may also load /course.geojson. */
const DEMO_COURSE: CourseFeature = {
  type: "Feature",
  properties: { name: "demo-loop" },
  geometry: {
    type: "LineString",
    coordinates: (() => {
      const o = { lat: 31.2304, lng: 121.4737 };
      const coords: [number, number][] = [];
      for (let k = 0; k <= 64; k++) {
        const ang = (k / 64) * Math.PI * 2;
        coords.push([
          o.lng + 0.0022 * Math.cos(ang),
          o.lat + 0.0017 * Math.sin(ang),
        ]);
      }
      return coords;
    })(),
  },
};

function pointsFromCourse(course: CourseFeature) {
  return course.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
}

/** Mutable course index — rebuilt on GPX upload / persisted load. */
let courseIndex: CourseIndex | null = null;

type ProjState = { sPrev: number; lap: number };
const projByParticipant = new Map<string, ProjState>();

const state: OverlayState = {
  event: { name: demo ? "演示赛" : "Race Live" },
  course: demo ? DEMO_COURSE : null,
  participants: {},
  mapStyle: undefined,
  listColumns: undefined,
};

/** device_id / IMEI → participant id (defaults to device_id). */
const deviceToParticipant = new Map<string, string>();

/** Last accepted fix per device (after jump filter). */
const lastAcceptedFix = new Map<string, AcceptedFix>();

const DEMO_COLORS = new Map(DEFAULT_ATHLETES.map((a) => [a.device_id, a.color]));

function rebuildCourseIndex(course: CourseFeature | null) {
  if (!course || course.geometry.coordinates.length < 2) {
    courseIndex = null;
    projByParticipant.clear();
    console.log("[course] index cleared (no course)");
    return;
  }
  try {
    courseIndex = buildCourseIndex(pointsFromCourse(course));
    projByParticipant.clear();
    console.log(
      `[course] index ready totalM=${courseIndex.totalM.toFixed(1)} m points=${courseIndex.points.length}`
    );
  } catch (err) {
    console.warn("[course] rebuild failed:", err);
    courseIndex = null;
    projByParticipant.clear();
  }
}

function applyUploadedCourse(result: GpxParseResult & { paths: string[] }) {
  state.course = result.feature;
  rebuildCourseIndex(result.feature);
  emitState();
  console.log(
    `[course] GPX applied points=${result.pointCount} totalM=${result.totalM.toFixed(1)} paths=${result.paths.length}`
  );
}

loadRoster();
loadDiscovery();
loadEventName();
loadSnapConfig();
if (!demo) {
  state.event = { name: getSession().event_name };
}
loadMapStyle();
loadListColumns();

if (demo) {
  rebuildCourseIndex(DEMO_COURSE);
} else {
  const persisted = loadPersistedCourse();
  if (persisted) {
    state.course = persisted;
    rebuildCourseIndex(persisted);
  } else {
    // Keep a projection index from DEMO only as fallback geometry for progress math;
    // state.course stays null so overlay does not paint the Shanghai demo loop.
    rebuildCourseIndex(DEMO_COURSE);
    console.log("[course] no persisted course.geojson — projection uses internal demo geometry only");
  }
}

setCourseUploadHandler(applyUploadedCourse);
startAdminServer(Number(process.env.ADMIN_PORT) || 8790);

/** Merge roster bib/name/color onto an existing or new participant. */
function applyRosterFields(p: Participant, deviceId: string) {
  const entry = resolveRosterEntry(deviceId) ?? getRosterEntry(deviceId);
  if (entry) {
    if (entry.bib) p.bib = entry.bib;
    if (entry.name) p.name = entry.name;
    if (entry.color) p.color = entry.color;
  }
}

function ensureParticipant(t: Telemetry): Participant {
  const id = deviceToParticipant.get(t.device_id) ?? t.device_id;
  deviceToParticipant.set(t.device_id, id);

  let p = state.participants[id];
  if (!p) {
    p = {
      id,
      bib: t.bib || id.slice(-4),
      name: t.name || id,
      color: DEMO_COLORS.get(t.device_id) ?? colorForId(id),
      online: true,
      athlete: t,
      trail: [] as TrailPoint[],
    };
    state.participants[id] = p;
  } else {
    p.bib = t.bib || p.bib;
    p.name = t.name || p.name;
    p.athlete = t;
  }
  const now = Date.now();
  p.last_seen_ms = now;
  p.last_fix_ms = now;

  // Roster is source of truth for display fields when present.
  applyRosterFields(p, t.device_id);

  // Unknown device: keep device_id as name fallback if still empty.
  if (!p.name) p.name = t.device_id;
  if (!p.bib) p.bib = t.device_id.slice(-4);

  refreshFixStatus(p, now);
  return p;
}

function colorForId(id: string): string {
  const palette = ["#ff3b5c", "#00e5ff", "#7cffb2", "#ffd166", "#c77dff", "#f4a261"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length]!;
}

function allowDevice(deviceId: string): boolean {
  // Always whitelist: empty roster → nobody on overlay (discovery still collects unknowns).
  return !!resolveRosterEntry(deviceId);
}

function refreshFixStatus(p: Participant, now = Date.now()) {
  const deviceId = p.athlete.device_id;
  const seen = p.last_seen_ms ?? 0;
  const recentPacket = seen > 0 && now - seen <= ONLINE_TIMEOUT_MS;
  const tcpUp = isDeviceOnline(deviceId);
  const isOnline = recentPacket || tcpUp;
  if (!isOnline) {
    p.fix_status = "offline";
    p.online = false;
    return;
  }
  const fixAt = p.last_fix_ms ?? 0;
  if (fixAt > 0 && now - fixAt <= FIX_FRESH_MS) {
    p.fix_status = "fixing";
    p.online = true;
    return;
  }
  p.fix_status = "online_no_fix";
  p.online = true;
}

function refreshAllFixStatuses(now = Date.now()) {
  for (const p of Object.values(state.participants)) {
    refreshFixStatus(p, now);
  }
}

/** Create / update participant from any uplink without moving lat/lng. */
function ensurePresenceParticipant(deviceId: string): Participant {
  const id = deviceToParticipant.get(deviceId) ?? deviceId;
  deviceToParticipant.set(deviceId, id);
  let p = state.participants[id];
  if (!p) {
    const entry = resolveRosterEntry(deviceId) ?? getRosterEntry(deviceId);
    p = {
      id,
      bib: entry?.bib || id.slice(-4),
      name: entry?.name || id,
      color: entry?.color || DEMO_COLORS.get(deviceId) || colorForId(id),
      online: false,
      fix_status: "offline",
      athlete: {
        device_id: deviceId,
        lat: 0,
        lng: 0,
        speed: 0,
        alt_baro: 0,
        ts: Date.now(),
        bib: entry?.bib || id.slice(-4),
        name: entry?.name || id,
        distance: 0,
        climb: 0,
      },
      trail: [],
    };
    state.participants[id] = p;
  }
  applyRosterFields(p, deviceId);
  return p;
}

function touchPresence(deviceId: string, opts: { zeroSpeed?: boolean; forceEmit?: boolean } = {}) {
  if (!isPlausibleDeviceId(deviceId)) return;
  if (!allowDevice(deviceId)) return;
  const p = ensurePresenceParticipant(deviceId);
  const now = Date.now();
  p.last_seen_ms = now;
  if (opts.zeroSpeed && p.athlete.speed !== 0) {
    p.athlete = { ...p.athlete, speed: 0 };
  }
  refreshFixStatus(p, now);
  const due = opts.forceEmit || now - lastPresenceEmitMs >= PRESENCE_EMIT_MIN_MS;
  if (due) {
    lastPresenceEmitMs = now;
    emitState();
  }
}

function seedRosterParticipants() {
  for (const entry of getRoster()) {
    ensurePresenceParticipant(entry.device_id);
    refreshFixStatus(state.participants[entry.device_id]!);
  }
}

/** Drop live participants / caches for device_ids no longer on the roster. */
function pruneParticipantsNotInRoster() {
  const roster = getRoster();
  const keep = new Set(roster.map((e) => e.device_id));
  // Empty roster → wipe all live participants from overlay.
  let removed = 0;

  for (const [deviceId, participantId] of [...deviceToParticipant.entries()]) {
    if (keep.has(deviceId)) continue;
    deviceToParticipant.delete(deviceId);
    lastAcceptedFix.delete(deviceId);
    if (state.participants[participantId]) {
      delete state.participants[participantId];
      projByParticipant.delete(participantId);
      removed++;
    }
  }

  // Orphans: participant id equals a removed device_id, or athlete.device_id not on roster.
  for (const [id, p] of Object.entries(state.participants)) {
    const deviceId = p.athlete?.device_id || id;
    if (keep.has(deviceId) || keep.has(id)) continue;
    delete state.participants[id];
    projByParticipant.delete(id);
    lastAcceptedFix.delete(deviceId);
    lastAcceptedFix.delete(id);
    deviceToParticipant.delete(deviceId);
    deviceToParticipant.delete(id);
    removed++;
  }

  if (removed > 0) {
    console.log(`[roster] pruned ${removed} participant(s) not on roster`);
  }
}

/** Project athlete GPS onto course; write progress_* onto participant.
 * Returns on-course lat/lng when projection is usable (for trail drawing).
 */
function applyCourseProjection(
  p: Participant,
  raw: { lat: number; lng: number }
): { lat: number; lng: number; dist: number } | null {
  if (!courseIndex || courseIndex.points.length < 2 || !state.course) {
    p.off_course = undefined;
    return null;
  }
  const prev = projByParticipant.get(p.id) ?? { sPrev: 0, lap: 0 };
  const maxMapM = getSnapConfig().maxMapM;
  const q = { lat: raw.lat, lng: raw.lng };
  let result = projectToCourse(courseIndex, q, {
    sPrev: prev.sPrev,
    lap: prev.lap,
    maxMapM,
  });

  // Finish-band lap wrap: near end, then near start → lap++
  const total = courseIndex.totalM;
  if (!result.offCourse && total > 0) {
    const band = Math.min(100, total * 0.08);
    if (prev.sPrev > total - band) {
      const raw = projectToCourse(courseIndex, q, { lap: prev.lap, maxMapM });
      if (!raw.offCourse && raw.s < band) {
        result = { ...raw, lap: prev.lap + 1 };
      }
    }
  }

  projByParticipant.set(p.id, { sPrev: result.s, lap: result.lap });

  const progress_m = result.s + result.lap * total;
  p.progress_m = progress_m;
  p.progress_pct = total > 0 ? Math.min(100, (result.s / total) * 100) : 0;
  p.dist_to_finish_m = Math.max(0, total - result.s);
  p.off_course = result.offCourse;
  p.lap = result.lap;

  if (result.offCourse || !result.proj) return null;
  return { lat: result.proj.lat, lng: result.proj.lng, dist: result.dist };
}

function clearAllSessionTrails() {
  for (const p of Object.values(state.participants)) {
    p.trail = [];
  }
}

function applyTelemetry(athlete: Telemetry) {
  const prev = lastAcceptedFix.get(athlete.device_id);
  if (prev) {
    const jump = checkJump(prev, {
      lat: athlete.lat,
      lng: athlete.lng,
      ts: athlete.ts,
      recv_ms: Date.now(),
    });
    if (jump.reject) {
      console.warn(
        `[gps] reject jump id=${athlete.device_id} step_m=${jump.step_m.toFixed(1)} ` +
          `dt=${jump.dt.toFixed(2)}s speed_ms=${jump.speed_ms.toFixed(1)} ` +
          `(nail previous)`
      );
      // Keep lat/lng nailed; clear HUD speed so stale km/h does not stick.
      touchPresence(athlete.device_id, { zeroSpeed: true, forceEmit: true });
      return;
    }
  }
  lastAcceptedFix.set(athlete.device_id, {
    lat: athlete.lat,
    lng: athlete.lng,
    ts: athlete.ts,
    recv_ms: Date.now(),
  });

  const rawGps = { lat: athlete.lat, lng: athlete.lng };
  const p = ensureParticipant(athlete);
  // Keep raw GPS on athlete for HUD/debug; display may snap to GPX.
  p.athlete = {
    ...p.athlete,
    raw_lat: rawGps.lat,
    raw_lng: rawGps.lng,
  };
  const onCourse = applyCourseProjection(p, rawGps);
  const snapOn = isSnapEnabled();
  if (snapOn && onCourse) {
    p.athlete = {
      ...p.athlete,
      lat: onCourse.lat,
      lng: onCourse.lng,
    };
  } else {
    p.athlete = {
      ...p.athlete,
      lat: rawGps.lat,
      lng: rawGps.lng,
    };
  }
  // Session trail follows display position (snapped when on-course).
  if (isSessionLive()) {
    pushTrailPoint(p.trail, {
      lat: p.athlete.lat,
      lng: p.athlete.lng,
      alt_baro: athlete.alt_baro,
      ts: Date.now(),
    });
  }
}

function emitState() {
  refreshAllFixStatuses();
  const sess = getSession();
  if (!demo) state.event = { name: sess.event_name };
  state.mapStyle = getMapStyle();
  state.listColumns = getListColumns().map(({ id, enabled }) => ({ id, enabled }));
  broadcast({
    event: state.event,
    course: state.course,
    participants: cloneParticipants(state.participants),
    mapStyle: state.mapStyle,
    listColumns: state.listColumns,
    session: sess,
    snap: getSnapConfig(),
  } as OverlayState);
}

function cloneParticipants(src: Record<string, Participant>): Record<string, Participant> {
  const out: Record<string, Participant> = {};
  for (const [id, p] of Object.entries(src)) {
    out[id] = { ...p, athlete: { ...p.athlete }, trail: [...p.trail] };
  }
  return out;
}

/** After admin save: re-merge roster onto live participants and push WS. */
function reapplyRosterToParticipants() {
  pruneParticipantsNotInRoster();
  for (const e of getRoster()) clearDiscoveredOnRoster(e.device_id);
  seedRosterParticipants();
  for (const [deviceId, participantId] of deviceToParticipant) {
    const p = state.participants[participantId];
    if (!p) continue;
    applyRosterFields(p, deviceId);
  }
  emitState();
}

setRosterReloadHandler(reapplyRosterToParticipants);
setMapStyleReloadHandler(() => emitState());
setListColumnsReloadHandler(() => emitState());
setSessionReloadHandler(() => emitState());
setSnapReloadHandler(() => emitState());

setSessionTrailClearer(clearAllSessionTrails);

if (demo) {
  console.log("[demo] publishing ~1Hz fake telemetry for 3 athletes");
  startDemoPublisher((batch) => {
    for (const t of batch) applyTelemetry(t);
    emitState();
  });
} else {
  const port =
    Number(process.env.H02_TCP_PORT) ||
    Number(process.env.MT909_TCP_PORT) ||
    5013;
  console.log(`[mt909] starting H02 TCP adapter (port ${port})`);
  // Real devices speak H02 ($ binary / * ASCII); device_id is Traccar-style id (not IMEI).
  seedRosterParticipants();
  pruneParticipantsNotInRoster();
  console.log(
    `[presence] onlineTimeout=${ONLINE_TIMEOUT_MS}ms fixFresh=${FIX_FRESH_MS}ms snap=${isSnapEnabled()}`
  );
  emitState();
  startH02TcpServer(
    (t) => {
      if (!isPlausibleDeviceId(t.device_id)) {
        console.warn(`[mt909] drop ghost device_id=${t.device_id}`);
        return;
      }
      if (!allowDevice(t.device_id)) {
        noteUnknownSighting(t.device_id, t.lat, t.lng);
        console.warn(`[mt909] ignore unknown device_id=${t.device_id} (pending discovery)`);
        return;
      }
      applyTelemetry(t);
      emitState();
    },
    port,
    {
      onInvalid: (deviceId, lat, lng) => {
        if (!isPlausibleDeviceId(deviceId)) return;
        if (!allowDevice(deviceId)) {
          if (typeof lat === "number" && typeof lng === "number") {
            noteUnknownSighting(deviceId, lat, lng);
          }
          return;
        }
        touchPresence(deviceId, { zeroSpeed: true });
      },
      onPresence: (deviceId) => {
        touchPresence(deviceId);
      },
    }
  );
  // Recompute online/fixing as timeouts elapse (no new packets).
  setInterval(() => {
    const before = JSON.stringify(
      Object.values(state.participants).map((p) => [p.id, p.online, p.fix_status])
    );
    refreshAllFixStatuses();
    const after = JSON.stringify(
      Object.values(state.participants).map((p) => [p.id, p.online, p.fix_status])
    );
    if (before !== after) emitState();
  }, 5000);
}

// mqtt.ts 可先留空占位
