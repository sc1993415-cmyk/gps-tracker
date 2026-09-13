import {
  extractGpxPoints,
  simplifyPoints,
  parseGpxToCourse,
  haversineM,
} from "./gpx.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function main() {
  const gpx = `<?xml version="1.0"?>
<gpx><trk><trkseg>
  <trkpt lat="31.2304" lon="121.4737"></trkpt>
  <trkpt lat="31.2304001" lon="121.4737001"></trkpt>
  <trkpt lat="31.2314" lon="121.4747"></trkpt>
  <trkpt lat="31.2324" lon="121.4757"></trkpt>
</trkseg></trk></gpx>`;

  const { points, source } = extractGpxPoints(gpx);
  assert(source === "trkpt", `source=${source}`);
  assert(points.length === 4, `raw=${points.length}`);

  const simp = simplifyPoints(points, 8);
  // first two are ~cm apart → merged; keep ≥3
  assert(simp.length === 3, `simp=${simp.length}`);
  assert(simp[0]!.lat === 31.2304, "keep first");
  assert(simp[simp.length - 1]!.lat === 31.2324, "keep last");

  const course = parseGpxToCourse(gpx);
  assert(course.feature.geometry.type === "LineString", "LineString");
  assert(course.pointCount >= 2, "≥2");
  assert(course.totalM > 0, "length");

  const near = haversineM(
    { lat: 31.23, lng: 121.47 },
    { lat: 31.230001, lng: 121.47 }
  );
  assert(near < 1, `near=${near}`);

  try {
    parseGpxToCourse(`<gpx><trkpt lat="1" lon="2"/></gpx>`);
    throw new Error("should reject <2 points");
  } catch (err) {
    assert(String(err).includes("≥2") || String(err).includes("2"), "reject short");
  }

  console.log("gpx-selftest PASS");
}

main();
