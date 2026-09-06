import type { TrailPoint } from "./ws-server.ts";

const MIN_M = 8;

function haversineM(a: TrailPoint, b: TrailPoint) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function pushTrailPoint(trail: TrailPoint[], p: TrailPoint, max = 2000) {
  const last = trail[trail.length - 1];
  if (!last || haversineM(last, p) >= MIN_M || p.ts - last.ts >= 1000) {
    trail.push(p);
    if (trail.length > max) trail.splice(0, trail.length - max);
  }
  return trail;
}
