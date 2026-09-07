import type { CourseFeature } from "./ws";

/** Inline fallback when /course.geojson is missing. */
export const DEMO_COURSE: CourseFeature = {
  type: "Feature",
  properties: { name: "demo-loop" },
  geometry: {
    type: "LineString",
    coordinates: (() => {
      const o = { lat: 31.2304, lng: 121.4737 };
      const coords: [number, number][] = [];
      for (let k = 0; k <= 64; k++) {
        const ang = (k / 64) * Math.PI * 2;
        coords.push([
          o.lng + 0.0022 * Math.cos(ang),
          o.lat + 0.0017 * Math.sin(ang),
        ]);
      }
      return coords;
    })(),
  },
};

export async function loadCourse(): Promise<CourseFeature | null> {
  try {
    const res = await fetch("/course.geojson", { cache: "no-store" });
    if (!res.ok) return DEMO_COURSE;
    const json = await res.json();
    if (json?.type === "Feature" && json?.geometry?.type === "LineString") {
      return json as CourseFeature;
    }
    if (json?.type === "FeatureCollection" && Array.isArray(json.features)) {
      const line = json.features.find(
        (f: CourseFeature) => f?.geometry?.type === "LineString"
      );
      if (line) return line as CourseFeature;
    }
    return DEMO_COURSE;
  } catch {
    return DEMO_COURSE;
  }
}
