import { WebSocketServer, WebSocket } from "ws";
import type { Telemetry } from "../../../packages/schema/src/telemetry.ts";

export type TrailPoint = { lat: number; lng: number; alt_baro: number; ts: number; gap?: boolean };

export type CourseFeature = {
  type: "Feature";
  properties?: Record<string, unknown>;
  geometry: { type: "LineString"; coordinates: [number, number][] };
};

export type Participant = {
  id: string;
  bib: string;
  name: string;
  nationality?: string;
  color?: string;
  online: boolean;
  athlete: Telemetry;
  trail: TrailPoint[];
  /** Along-course projection fields (from course-project). */
  progress_m?: number;
  progress_pct?: number;
  dist_to_finish_m?: number;
  off_course?: boolean;
  lap?: number;
  cum_climb_m?: number;
  last_alt_m?: number;
  gps_distance_m?: number;
  pace_s_per_km?: number;

  /** Server receive time (ms since epoch) of any uplink (fix/heartbeat/invalid). */
  last_seen_ms?: number;
  /** Server receive time of last accepted valid=true fix. */
  last_fix_ms?: number;
  /** Derived: fixing | online_no_fix | offline */
  fix_status?: "fixing" | "online_no_fix" | "offline";
};

/** Multi-athlete live overlay payload (Phase 1). */
export type SessionStatus = "idle" | "live" | "ended";

export type SessionInfo = {
  status: SessionStatus;
  event_name: string;
  started_ms?: number;
  ended_ms?: number;
};

export type OverlayState = {
  event?: { name: string };
  course?: CourseFeature | null;
  participants: Record<string, Participant>;
  /** OpenFreeMap style id + url for overlay basemap. */
  mapStyle?: { id: string; url: string };
  /** Athlete list column visibility for overlay. */
  listColumns?: { id: string; enabled: boolean }[];
  /** Live session: start/end/reset recording for playback. */
  session?: SessionInfo;
  /** Course snap: marker+trail use projected point when within maxMapM. */
  snap?: { enabled: boolean; maxMapM: number };
  /** Yellow trail / marker teleport break distance. */
  trailBreak?: { breakM: number };
  interpDelay?: { enabled: boolean };
  hudFields?: { id: string; enabled: boolean }[];
  courseEnds?: { enabled: boolean };
  rankFinish?: { enabled: boolean };
};

/** Legacy single-athlete shape (kept for docs / shim reference). */
export type LegacyOverlayState = {
  athlete: Telemetry;
  trail: TrailPoint[];
};

export function createWsServer(port = 8787) {
  const wss = new WebSocketServer({ port });
  let latest: OverlayState | null = null;

  const broadcast = (state: OverlayState) => {
    latest = state;
    const msg = JSON.stringify(state);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  };

  wss.on("connection", (socket) => {
    if (latest) socket.send(JSON.stringify(latest));
  });

  console.log(`[ws] listening on ws://localhost:${port}`);
  return { broadcast, wss };
}
