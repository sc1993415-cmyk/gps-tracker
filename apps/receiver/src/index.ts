import { createWsServer } from "./ws-server.ts";
import { pushTrailPoint } from "./downsample.ts";
import { startDemoPublisher, DEFAULT_ATHLETES } from "./demo-publisher.ts";
import { startMt909TcpServer } from "./mt909-tcp.ts";
import type { OverlayState, Participant, TrailPoint, CourseFeature } from "./ws-server.ts";
import type { Telemetry } from "../../../packages/schema/src/telemetry.ts";

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

const state: OverlayState = {
  event: { name: demo ? "Demo Race" : "Live Tracking" },
  course: demo ? DEMO_COURSE : null,
  participants: {},
};

/** device_id / IMEI → participant id (defaults to device_id). */
const deviceToParticipant = new Map<string, string>();

const DEMO_COLORS = new Map(DEFAULT_ATHLETES.map((a) => [a.device_id, a.color]));

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
  return p;
}

function colorForId(id: string): string {
  const palette = ["#ff3b5c", "#00e5ff", "#7cffb2", "#ffd166", "#c77dff", "#f4a261"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length]!;
}

function applyTelemetry(athlete: Telemetry) {
  const p = ensureParticipant(athlete);
  pushTrailPoint(p.trail, {
    lat: athlete.lat,
    lng: athlete.lng,
    alt_baro: athlete.alt_baro,
    ts: athlete.ts,
  });
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
