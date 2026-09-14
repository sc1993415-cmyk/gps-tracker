import { haversineM } from "./geo.ts";
import type { CourseIndex, LatLng } from "./types.ts";

export function buildCourseIndex(points: LatLng[]): CourseIndex {
  if (points.length < 2) throw new Error("course needs ≥2 points");
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + haversineM(points[i - 1], points[i]));
  }
  return { points, cum, totalM: cum[cum.length - 1] };
}

/** Interpolate a point at along-track distance s (meters, wraps by totalM). */
export function pointAtS(course: CourseIndex, s: number): LatLng {
  const { points, cum, totalM } = course;
  if (!points.length) return { lat: 0, lng: 0 };
  if (totalM <= 0) return points[0]!;
  let x = s % totalM;
  if (x < 0) x += totalM;
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1]! < x) i++;
  const seg = (cum[i + 1]! - cum[i]!) || 1;
  const t = (x - cum[i]!) / seg;
  const a = points[i]!;
  const b = points[i + 1] ?? a;
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

export { projectToCourse } from "./project.ts";
export type { CourseIndex, LatLng, ProjectResult } from "./types.ts";
