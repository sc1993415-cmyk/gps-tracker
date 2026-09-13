import { WebSocketServer, WebSocket } from "ws";
import type { Telemetry } from "../../../packages/schema/src/telemetry.ts";

export type TrailPoint = { lat: number; lng: number; alt_baro: number; ts: number };

export type CourseFeature = {
  type: "Feature";
  properties?: Record<string, unknown>;
  geometry: { type: "LineString"; coordinates: [number, number][] };
};

export type Participant = {
  id: string;
  bib: string;
  name: string;
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
  /** Server receive time (ms since epoch) for list last-update. */
  last_seen_ms?: number;
};

/** Multi-athlete live overlay payload (Phase 1). */
export type OverlayState = {
  event?: { name: string };
  course?: CourseFeature | null;
  participants: Record<string, Participant>;
  /** OpenFreeMap style id + url for overlay basemap. */
  mapStyle?: { id: string; url: string };
  /** Athlete list column visibility for overlay. */
  listColumns?: { id: string; enabled: boolean }[];
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
