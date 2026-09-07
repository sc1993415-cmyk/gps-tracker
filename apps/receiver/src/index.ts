import { createWsServer } from "./ws-server.ts";
import { pushTrailPoint } from "./downsample.ts";
import { startDemoPublisher, DEFAULT_ATHLETES } from "./demo-publisher.ts";
import { startMt909TcpServer } from "./mt909-tcp.ts";
import { startAdminServer } from "./admin-server.ts";
import {
  loadRoster,
  getRosterEntry,
  setRosterReloadHandler,
} from "./roster.ts";
import type { OverlayState, Participant, TrailPoint, CourseFeature } from "./ws-server.ts";
import type { Telemetry } from "../../../packages/schema/src/telemetry.ts";
import {
  buildCourseIndex,
  projectToCourse,
  type CourseIndex,
} from "course-project";

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

/** Built once from the same demo course the overlay uses. */
const courseIndex: CourseIndex = buildCourseIndex(pointsFromCourse(DEMO_COURSE));

type ProjState = { sPrev: number; lap: number };
const projByParticipant = new Map<string, ProjState>();

const state: OverlayState = {
  event: { name: demo ? "演示赛" : "实时追踪" },
  course: demo ? DEMO_COURSE : null,
  participants: {},
};

/** device_id / IMEI → participant id (defaults to device_id). */
const deviceToParticipant = new Map<string, string>();

const DEMO_COLORS = new Map(DEFAULT_ATHLETES.map((a) => [a.device_id, a.color]));

loadRoster();
startAdminServer(Number(process.env.ADMIN_PORT) || 8790);

/** Merge roster bib/name/color onto an existing or new participant. */
function applyRosterFields(p: Participant, deviceId: string) {
  const entry = getRosterEntry(deviceId);
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
    p.online = true;
    p.athlete = t;
  }

  // Roster is source of truth for display fields when present.
  applyRosterFields(p, t.device_id);

  // Unknown device: keep device_id as name fallback if still empty.
  if (!p.name) p.name = t.device_id;
  if (!p.bib) p.bib = t.device_id.slice(-4);

  return p;
}

function colorForId(id: string): string {
  const palette = ["#ff3b5c", "#00e5ff", "#7cffb2", "#ffd166", "#c77dff", "#f4a261"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length]!;
}

/** Project athlete GPS onto course; write progress_* onto participant. */
function applyCourseProjection(p: Participant) {
  const prev = projByParticipant.get(p.id) ?? { sPrev: 0, lap: 0 };
  const q = { lat: p.athlete.lat, lng: p.athlete.lng };
  let result = projectToCourse(courseIndex, q, {
    sPrev: prev.sPrev,
    lap: prev.lap,
  });

  // Finish-band lap wrap: near end, then near start → lap++
  const total = courseIndex.totalM;
  if (!result.offCourse && total > 0) {
    const band = Math.min(100, total * 0.08);
    if (prev.sPrev > total - band) {
      const raw = projectToCourse(courseIndex, q, { lap: prev.lap });
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
}

function applyTelemetry(athlete: Telemetry) {
  const p = ensureParticipant(athlete);
  pushTrailPoint(p.trail, {
    lat: athlete.lat,
    lng: athlete.lng,
    alt_baro: athlete.alt_baro,
    ts: athlete.ts,
  });
  applyCourseProjection(p);
}

function emitState() {
  broadcast({
    event: state.event,
    course: state.course,
    participants: cloneParticipants(state.participants),
  });
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
  for (const [deviceId, participantId] of deviceToParticipant) {
    const p = state.participants[participantId];
    if (!p) continue;
    applyRosterFields(p, deviceId);
  }
  emitState();
}

setRosterReloadHandler(reapplyRosterToParticipants);

console.log(
  `[course] index ready totalM=${courseIndex.totalM.toFixed(1)} m points=${courseIndex.points.length}`
);

if (demo) {
  console.log("[demo] publishing ~1Hz fake telemetry for 3 athletes");
  startDemoPublisher((batch) => {
    for (const t of batch) applyTelemetry(t);
    emitState();
  });
} else {
  const port = Number(process.env.MT909_TCP_PORT) || 5013;
  console.log(`[mt909] starting TCP adapter (port ${port})`);
  // Map each device_id/IMEI → one participant; update that participant only, then broadcast full state
  startMt909TcpServer((t) => {
    applyTelemetry(t);
    emitState();
  }, port);
}

// mqtt.ts 可先留空占位
