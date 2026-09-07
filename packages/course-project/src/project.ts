import { closestOnSegment } from "./geo.ts";
import type { CourseIndex, LatLng, ProjectResult } from "./types.ts";

export function projectToCourse(
  course: CourseIndex,
  q: LatLng,
  opts: { sPrev?: number; lap?: number; maxMapM?: number; windowM?: number } = {}
): ProjectResult {
  const maxMapM = opts.maxMapM ?? 100;
  const windowM = opts.windowM ?? 400;
  const lap = opts.lap ?? 0;
  const sPrev = opts.sPrev ?? 0;
  const { points, cum } = course;

  let i0 = 0, i1 = points.length - 2;
  if (opts.sPrev != null) {
    const lo = Math.max(0, sPrev - windowM);
    const hi = sPrev + windowM;
    while (i0 < cum.length - 1 && cum[i0 + 1] < lo) i0++;
    i1 = i0;
    while (i1 < points.length - 2 && cum[i1] < hi) i1++;
  }

  let best = { dist: Infinity, s: 0, proj: points[0] };
  for (let i = i0; i <= i1; i++) {
    const { proj, t, dist } = closestOnSegment(q, points[i], points[i + 1]);
    const seg = cum[i + 1] - cum[i];
    const s = cum[i] + t * seg;
    if (dist < best.dist) best = { dist, s, proj };
  }

  const offCourse = best.dist > maxMapM;
  let s = offCourse ? sPrev : best.s;
  if (!offCourse && s < sPrev) s = sPrev; // 同圈单调

  return { s, proj: best.proj, dist: best.dist, offCourse, lap };
}
