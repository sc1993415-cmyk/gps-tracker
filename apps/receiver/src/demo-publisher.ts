import type { Telemetry } from "../../../packages/schema/src/telemetry.ts";

export type DemoAthleteSpec = {
  device_id: string;
  bib: string;
  name: string;
  color: string;
  /** Phase offset in radians so athletes spread on the same circle. */
  phase: number;
  /** Radius scale vs base ellipse. */
  radiusScale?: number;
};

const DEFAULT_ATHLETES: DemoAthleteSpec[] = [
  { device_id: "demo-1", bib: "42", name: "Alice", color: "#ff3b5c", phase: 0 },
  { device_id: "demo-2", bib: "7", name: "Bob", color: "#00e5ff", phase: (2 * Math.PI) / 3 },
  { device_id: "demo-3", bib: "21", name: "Chen", color: "#7cffb2", phase: (4 * Math.PI) / 3, radiusScale: 0.85 },
];

/** 2–3 athletes on phase-shifted ellipses around Shanghai, ~1Hz each tick batch. */
export function startDemoPublisher(
  onTick: (batch: Telemetry[]) => void,
  hz = 1,
  athletes: DemoAthleteSpec[] = DEFAULT_ATHLETES
) {
  const origin = { lat: 31.2304, lng: 121.4737 };
  let i = 0;
  const distances = athletes.map(() => 0);
  const climbs = athletes.map(() => 0);
  const prevAlts = athletes.map(() => 12);

  const timer = setInterval(() => {
    const batch: Telemetry[] = athletes.map((spec, idx) => {
      const scale = spec.radiusScale ?? 1;
      const ang = (i / 60) * Math.PI * 2 + spec.phase;
      const lat = origin.lat + 0.0015 * scale * Math.sin(ang);
      const lng = origin.lng + 0.002 * scale * Math.cos(ang);
      const speed = 12 + 3 * Math.sin(i / 8 + spec.phase);
      const alt_baro = 12 + 25 * (0.5 + 0.5 * Math.sin(ang));
      distances[idx]! += Math.max(speed, 0) / 3.6;
      climbs[idx]! += Math.max(0, alt_baro - prevAlts[idx]!);
      prevAlts[idx] = alt_baro;

      return {
        device_id: spec.device_id,
        lat,
        lng,
        speed: Math.round(speed * 10) / 10,
        alt_baro: Math.round(alt_baro * 10) / 10,
        ts: Date.now(),
        bib: spec.bib,
        name: spec.name,
        distance: Math.round(distances[idx]!),
        climb: Math.round(climbs[idx]!),
      };
    });
    onTick(batch);
    i += 1;
  }, 1000 / hz);

  return () => clearInterval(timer);
}

export { DEFAULT_ATHLETES };
