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

export { projectToCourse } from "./project.ts";
export type { CourseIndex, LatLng, ProjectResult } from "./types.ts";
