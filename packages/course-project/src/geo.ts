import type { LatLng } from "./types.ts";

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 点到线段最近点（平面近似，短段够用） */
export function closestOnSegment(q: LatLng, a: LatLng, b: LatLng) {
  const ax = a.lng, ay = a.lat, bx = b.lng, by = b.lat;
  const qx = q.lng, qy = q.lat;
  const abx = bx - ax, aby = by - ay;
  const ab2 = abx * abx + aby * aby || 1e-12;
  let t = ((qx - ax) * abx + (qy - ay) * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const proj = { lat: ay + t * aby, lng: ax + t * abx };
  return { proj, t, dist: haversineM(q, proj) };
}
