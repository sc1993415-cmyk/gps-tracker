export type TrailPoint = { lat: number; lng: number; alt_baro: number; ts: number; gap?: boolean };

export type Telemetry = {
  device_id: string;
  lat: number;
  lng: number;
  speed: number;
  alt_baro: number;
  ts: number;
  bib: string;
  name: string;
  distance: number;
  climb: number;
  heading?: number;
  battery_pct?: number;
  battery?: number;
  battery_bars?: number;
  raw_lat?: number;
  raw_lng?: number;
  /** Fix source after GPS/LBS selection. */
  source?: "gps" | "lbs" | "coast";
  mcc?: number;
  mnc?: number;
  lac?: number;
  ci?: number;
  lbs_match?: "exact" | "lac" | "lac_any_mnc";
  lbs_range_m?: number;
  raw_hex?: string;
};

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
  /** Along-course progress from receiver projection (meters, includes laps). */
  progress_m?: number;
  progress_pct?: number;
  dist_to_finish_m?: number;
  off_course?: boolean;
  lap?: number;
  cum_climb_m?: number;
  gps_distance_m?: number;
  pace_s_per_km?: number;

  last_seen_ms?: number;
  last_fix_ms?: number;
  fix_status?: "fixing" | "online_no_fix" | "offline";
};

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
  mapStyle?: { id: string; url: string };
  listColumns?: { id: string; enabled: boolean }[];
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

/** Legacy single-athlete shape — wrapped as one participant when received. */
type LegacyOverlayState = { athlete: Telemetry; trail: TrailPoint[] };

export function normalizeOverlayState(raw: unknown): OverlayState {
  if (!raw || typeof raw !== "object") return { participants: {} };
  const o = raw as Record<string, unknown>;

  if (o.participants && typeof o.participants === "object") {
    return {
      event: o.event as OverlayState["event"],
      course: (o.course as OverlayState["course"]) ?? null,
      participants: o.participants as Record<string, Participant>,
      mapStyle: (o.mapStyle as OverlayState["mapStyle"]) ?? undefined,
      listColumns: (o.listColumns as OverlayState["listColumns"]) ?? undefined,
      session: (o.session as OverlayState["session"]) ?? undefined,
      snap: (o.snap as OverlayState["snap"]) ?? undefined,
      trailBreak: (o.trailBreak as OverlayState["trailBreak"]) ?? undefined,
      interpDelay: (o.interpDelay as OverlayState["interpDelay"]) ?? undefined,
      hudFields: (o.hudFields as OverlayState["hudFields"]) ?? undefined,
      courseEnds: (o.courseEnds as OverlayState["courseEnds"]) ?? undefined,
      rankFinish: (o.rankFinish as OverlayState["rankFinish"]) ?? undefined,
    };
  }

  // Backward-compat shim: { athlete, trail } → one participant
  const legacy = o as Partial<LegacyOverlayState>;
  if (legacy.athlete) {
    const a = legacy.athlete;
    const id = a.device_id || "solo";
    return {
      participants: {
        [id]: {
          id,
          bib: a.bib || "",
          name: a.name || id,
          online: true,
          athlete: a,
          trail: legacy.trail ?? [],
        },
      },
    };
  }

  return { participants: {} };
}

export function connectOverlayWs(
  url = typeof location !== "undefined" ? `ws://${location.hostname}:8787` : "ws://localhost:8787",
  onState: (s: OverlayState) => void
) {
  let retry = 0;
  const connect = () => {
    const ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      try {
        onState(normalizeOverlayState(JSON.parse(String(ev.data))));
      } catch {}
    };
    ws.onclose = () => {
      const wait = Math.min(5000, 500 * 2 ** retry++);
      setTimeout(connect, wait);
    };
    ws.onopen = () => {
      retry = 0;
    };
  };
  connect();
}
