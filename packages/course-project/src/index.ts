export type { LatLng, CourseIndex, ProjectResult } from "./types.ts";
export { haversineM, closestOnSegment } from "./geo.ts";

import type { LatLng, CourseIndex, ProjectResult } from "./types.ts";

/**
 * TODO(index): GPX/GeoJSON LineString → points P[i];
 * segLen[i]; prefix cum[i] = along-track meters to P[i]; totalM = cum[n-1].
 */
export function buildCourseIndex(points: LatLng[]): CourseIndex {
  void points;
  throw new Error("TODO: buildCourseIndex — cum GPX index not implemented yet");
}

/**
 * TODO(project): windowed nearest-segment project (±W from prior s, full track on first).
 * TODO(filter): dist > maxMapM → offCourse, do not advance s; clamp |Δs|/Δt speed.
 * TODO(anti-lap): monotonic s within lap; multi-lap via finish band; forbid large backtrack.
 */
export function projectPoint(
  _index: CourseIndex,
  _q: LatLng,
  _prev?: { s: number; lap: number; ts?: number }
): ProjectResult {
  throw new Error("TODO: projectPoint — project/filter/anti-backtrack not implemented yet");
}
