import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CourseFeature } from "./ws-server.ts";

export type LatLng = { lat: number; lng: number };

export type GpxParseResult = {
  feature: CourseFeature;
  pointCount: number;
  totalM: number;
  source: "trkpt" | "rtept";
};

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Extract lat/lon from <trkpt> or <rtept> tags (attribute order flexible). */
export function extractGpxPoints(xml: string): { points: LatLng[]; source: "trkpt" | "rtept" } {
  const trk: LatLng[] = [];
  const rte: LatLng[] = [];
  const re =
    /<(trkpt|rtept)\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const tag = m[1]!.toLowerCase();
    const attrs = m[2] ?? "";
    const latM = attrs.match(/\blat\s*=\s*["']([^"']+)["']/i);
    const lonM =
      attrs.match(/\blon\s*=\s*["']([^"']+)["']/i) ||
      attrs.match(/\blng\s*=\s*["']([^"']+)["']/i);
    if (!latM || !lonM) continue;
    const lat = Number(latM[1]);
    const lng = Number(lonM[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    (tag === "trkpt" ? trk : rte).push({ lat, lng });
  }
  if (trk.length >= 2) return { points: trk, source: "trkpt" };
  if (rte.length >= 2) return { points: rte, source: "rtept" };
  if (trk.length) return { points: trk, source: "trkpt" };
  return { points: rte, source: "rtept" };
}

/**
 * Merge adjacent points closer than `minDistM` (default 8 m).
 * Always keeps first and last.
 */
export function simplifyPoints(points: LatLng[], minDistM = 8): LatLng[] {
  if (points.length <= 2) return points.slice();
  const out: LatLng[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const cur = points[i]!;
    if (haversineM(prev, cur) >= minDistM) out.push(cur);
  }
  const last = points[points.length - 1]!;
  if (out.length === 0 || haversineM(out[out.length - 1]!, last) > 0.01) {
    out.push(last);
  } else {
    out[out.length - 1] = last;
  }
  return out;
}

export function pathLengthM(points: LatLng[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += haversineM(points[i - 1]!, points[i]!);
  return n;
}

export function parseGpxToCourse(xml: string, name = "uploaded-course"): GpxParseResult {
  const { points: raw, source } = extractGpxPoints(xml);
  if (raw.length < 2) {
    throw new Error(`GPX needs ≥2 track/route points (got ${raw.length})`);
  }
  const points = simplifyPoints(raw, 8);
  if (points.length < 2) {
    throw new Error("GPX simplify left <2 points");
  }
  const totalM = pathLengthM(points);
  const feature: CourseFeature = {
    type: "Feature",
    properties: {
      name,
      source: "gpx",
      pointCount: points.length,
      totalM: Math.round(totalM * 10) / 10,
      rawPointCount: raw.length,
    },
    geometry: {
      type: "LineString",
      coordinates: points.map((p) => [p.lng, p.lat] as [number, number]),
    },
  };
  return { feature, pointCount: points.length, totalM, source };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Receiver-side persisted course (also used to rebuild CourseIndex on boot). */
export const RECEIVER_COURSE_PATH = path.resolve(__dirname, "../data/course.geojson");

/** Overlay Vite `public/` — served as /course.geojson in preview/prod build. */
export const OVERLAY_COURSE_PATH = path.resolve(
  __dirname,
  "../../overlay/public/course.geojson"
);

let onCourseUploaded:
  | ((result: GpxParseResult & { paths: string[] }) => void)
  | null = null;

export function setCourseUploadHandler(
  fn: ((result: GpxParseResult & { paths: string[] }) => void) | null
) {
  onCourseUploaded = fn;
}

export function loadPersistedCourse(): CourseFeature | null {
  try {
    if (!fs.existsSync(RECEIVER_COURSE_PATH)) return null;
    const json = JSON.parse(fs.readFileSync(RECEIVER_COURSE_PATH, "utf8"));
    if (json?.type === "Feature" && json?.geometry?.type === "LineString") {
      return json as CourseFeature;
    }
    if (json?.type === "FeatureCollection" && Array.isArray(json.features)) {
      const line = json.features.find(
        (f: CourseFeature) => f?.geometry?.type === "LineString"
      );
      return (line as CourseFeature) ?? null;
    }
    return null;
  } catch (err) {
    console.warn("[gpx] load persisted course failed:", err);
    return null;
  }
}

/** Write GeoJSON to overlay public + receiver data, then notify handler. */
export function saveCourseFeature(
  feature: CourseFeature,
  meta?: { pointCount?: number; totalM?: number; source?: string }
): { paths: string[]; pointCount: number; totalM: number } {
  const text = JSON.stringify(feature, null, 2) + "\n";
  const paths: string[] = [];
  for (const p of [RECEIVER_COURSE_PATH, OVERLAY_COURSE_PATH]) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, "utf8");
    paths.push(p);
  }
  const coords = feature.geometry.coordinates;
  const points = coords.map(([lng, lat]) => ({ lat, lng }));
  const pointCount = meta?.pointCount ?? points.length;
  const totalM = meta?.totalM ?? pathLengthM(points);
  console.log(
    `[gpx] wrote course points=${pointCount} totalM=${totalM.toFixed(1)} → ${paths.join(" , ")}`
  );
  return { paths, pointCount, totalM };
}

export const OVERLAY_DIST_COURSE_PATH = path.resolve(
  __dirname,
  "../../overlay/dist/course.geojson"
);

export function clearPersistedCourse(): { removed: string[] } {
  const removed: string[] = [];
  for (const p of [RECEIVER_COURSE_PATH, OVERLAY_COURSE_PATH, OVERLAY_DIST_COURSE_PATH]) {
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        removed.push(p);
      }
    } catch (err) {
      console.warn("[gpx] unlink failed", p, err);
    }
  }
  console.log("[gpx] cleared course files", removed.length ? removed.join(" , ") : "(none)");
  onCourseUploaded?.({
    feature: {
      type: "Feature",
      properties: { name: "", cleared: true },
      geometry: { type: "LineString", coordinates: [] },
    } as CourseFeature,
    pointCount: 0,
    totalM: 0,
    source: "cleared",
    paths: removed,
  });
  return { removed };
}

export function uploadGpx(xml: string, name?: string): GpxParseResult & { paths: string[] } {
  const parsed = parseGpxToCourse(xml, name || "uploaded-course");
  const { paths } = saveCourseFeature(parsed.feature, {
    pointCount: parsed.pointCount,
    totalM: parsed.totalM,
    source: parsed.source,
  });
  const result = { ...parsed, paths };
  onCourseUploaded?.(result);
  return result;
}
