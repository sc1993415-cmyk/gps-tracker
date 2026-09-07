export type TrailPoint = { lat: number; lng: number; alt_baro: number; ts: number };

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
  color?: string;
  online: boolean;
  athlete: Telemetry;
  trail: TrailPoint[];
};

export type OverlayState = {
  event?: { name: string };
  course?: CourseFeature | null;
  participants: Record<string, Participant>;
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
  url = "ws://localhost:8787",
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
