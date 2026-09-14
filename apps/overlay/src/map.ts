import maplibregl from "maplibre-gl";
import type { OverlayState, CourseFeature } from "./ws";

export const OPENFREEMAP_STYLES = {
  positron: "https://tiles.openfreemap.org/styles/positron",
  liberty: "https://tiles.openfreemap.org/styles/liberty",
} as const;

export type BasemapId = keyof typeof OPENFREEMAP_STYLES;

const DEFAULT_STYLE_URL = OPENFREEMAP_STYLES.positron;

/** Fallback lerp when we have no recv-interval samples yet (~1Hz). */
const DEFAULT_LERP_MS = 900;
const LERP_EPSILON = 1e-7;
/** Reconnect / sleep gaps larger than this do not enter the T estimate. */
const MAX_INTERVAL_FOR_T_MS = 15_000;
const INTERVAL_WINDOW = 10;
const LERP_MIN_MS = 400;
const LERP_MAX_MS = 8_000;
const LERP_FACTOR = 0.85;

function medianMs(samples: number[]): number {
  if (!samples.length) return 1_000;
  const s = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** clamp(0.85×T, 0.4s, 8s) from median recv interval T. */
function lerpMsFromIntervals(samples: number[]): number {
  const usable = samples.filter((x) => x > 0 && x <= MAX_INTERVAL_FOR_T_MS);
  const T = usable.length ? medianMs(usable) : 1_000;
  return Math.min(LERP_MAX_MS, Math.max(LERP_MIN_MS, LERP_FACTOR * T));
}

type MarkerRuntime = {
  marker: maplibregl.Marker;
  el: HTMLElement;
  displayLng: number;
  displayLat: number;
  targetLng: number;
  targetLat: number;
  lerpFromLng: number;
  lerpFromLat: number;
  lerpStartMs: number;
  /** Dynamic duration from recent recv intervals. */
  lerpMs: number;
  lastTargetUpdateMs: number;
  intervalSamples: number[];
  rafId: number;
};

export type MapController = {
  update: (
    state: OverlayState,
    opts: {
      selectedId: string | null;
      follow: boolean;
      hideNonSelected: boolean;
      courseOverride?: CourseFeature | null;
      /** When set, draw trails (live/ended session). Idle → no session trail. */
      showTrails?: boolean;
      /** Playback: override marker lat/lng by participant id. */
      positionOverrides?: Record<string, { lat: number; lng: number }>;
    }
  ) => void;
  setFollow: (follow: boolean) => void;
  setBasemapUrl: (url: string) => void;
};

export function createMap(
  container: string,
  initialStyleUrl = DEFAULT_STYLE_URL
): MapController {
  const map = new maplibregl.Map({
    container,
    style: initialStyleUrl,
    center: [121.4737, 31.2304],
    zoom: 14,
    attributionControl: true,
  });

  const markers = new Map<string, MarkerRuntime>();
  let followSelected = true;
  let courseReady = false;
  let activeStyleUrl = initialStyleUrl;
  let lastCourse: CourseFeature | null | undefined;
  let lastTrailFc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };
  let lastLbsFc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };
  let cameraFitted = false;

  function mountOverlayLayers() {
    if (!map.getSource("course")) {
      map.addSource("course", { type: "geojson", data: emptyLine() });
      map.addLayer({
        id: "course-line",
        type: "line",
        source: "course",
        paint: {
          "line-color": "#e53935",
          "line-width": 6,
          "line-opacity": 0.75,
        },
      });
    }
    if (!map.getSource("trails")) {
      map.addSource("trails", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "trails-line",
        type: "line",
        source: "trails",
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["==", ["get", "selected"], 1], 5, 2.5],
          "line-opacity": ["case", ["==", ["get", "selected"], 1], 1, 0.45],
        },
      });
    }
    if (!map.getSource("lbs")) {
      map.addSource("lbs", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "lbs-accuracy-fill",
        type: "fill",
        source: "lbs",
        filter: ["==", ["get", "kind"], "accuracy"],
        paint: {
          "fill-color": "#22c55e",
          "fill-opacity": 0.16,
        },
      });
      map.addLayer({
        id: "lbs-accuracy-line",
        type: "line",
        source: "lbs",
        filter: ["==", ["get", "kind"], "accuracy"],
        paint: {
          "line-color": "#22c55e",
          "line-width": 2,
          "line-opacity": 0.85,
          "line-dasharray": [2, 1.5],
        },
      });
      map.addLayer({
        id: "lbs-point",
        type: "circle",
        source: "lbs",
        filter: ["==", ["get", "kind"], "center"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#22c55e",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
    }
    courseReady = true;
    // Restore last course/trails after style swap
    const courseSrc = map.getSource("course") as maplibregl.GeoJSONSource | undefined;
    if (courseSrc) {
      if (lastCourse?.geometry?.coordinates?.length) courseSrc.setData(lastCourse);
      else courseSrc.setData(emptyLine());
    }
    const trailsSrc = map.getSource("trails") as maplibregl.GeoJSONSource | undefined;
    trailsSrc?.setData(lastTrailFc);
    const lbsSrc = map.getSource("lbs") as maplibregl.GeoJSONSource | undefined;
    lbsSrc?.setData(lastLbsFc);
  }

  map.on("load", () => mountOverlayLayers());
  map.on("style.load", () => mountOverlayLayers());

  function ensureMarker(id: string, color: string): MarkerRuntime {
    let rt = markers.get(id);
    if (rt) return rt;

    const el = document.createElement("div");
    el.className = "athlete-marker";
    el.dataset.id = id;
    el.style.setProperty("--dot-color", color);

    const flag = document.createElement("div");
    flag.className = "athlete-flag";
    el.appendChild(flag);

    const dot = document.createElement("div");
    dot.className = "athlete-dot";
    el.appendChild(dot);

    const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([121.4737, 31.2304])
      .addTo(map);

    rt = {
      marker,
      el,
      displayLng: 121.4737,
      displayLat: 31.2304,
      targetLng: 121.4737,
      targetLat: 31.2304,
      lerpFromLng: 121.4737,
      lerpFromLat: 31.2304,
      lerpStartMs: 0,
      lerpMs: DEFAULT_LERP_MS,
      lastTargetUpdateMs: 0,
      intervalSamples: [],
      rafId: 0,
    };
    markers.set(id, rt);
    return rt;
  }

  function tickMarker(rt: MarkerRuntime, now: number) {
    const dur = Math.max(1, rt.lerpMs || DEFAULT_LERP_MS);
    const t = Math.min(1, (now - rt.lerpStartMs) / dur);
    const eased = 1 - (1 - t) ** 3;
    rt.displayLng = rt.lerpFromLng + (rt.targetLng - rt.lerpFromLng) * eased;
    rt.displayLat = rt.lerpFromLat + (rt.targetLat - rt.lerpFromLat) * eased;
    rt.marker.setLngLat([rt.displayLng, rt.displayLat]);

    if (t < 1) {
      rt.rafId = requestAnimationFrame((n) => tickMarker(rt, n));
    } else {
      rt.displayLng = rt.targetLng;
      rt.displayLat = rt.targetLat;
      rt.marker.setLngLat([rt.displayLng, rt.displayLat]);
      rt.rafId = 0;
    }
  }

  function startOrRestartLerp(rt: MarkerRuntime) {
    rt.lerpFromLng = rt.displayLng;
    rt.lerpFromLat = rt.displayLat;
    rt.lerpStartMs = performance.now();
    if (!rt.rafId) {
      rt.rafId = requestAnimationFrame((n) => tickMarker(rt, n));
    }
  }

  function setCourse(course: CourseFeature | null | undefined) {
    lastCourse = course ?? null;
    if (!courseReady) return;
    const src = map.getSource("course") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (course?.geometry?.coordinates?.length) {
      src.setData(course);
    } else {
      src.setData(emptyLine());
    }
  }

  return {
    setFollow(follow: boolean) {
      followSelected = follow;
    },
    setBasemapUrl(url: string) {
      const next = (url || "").trim();
      if (!next || next === activeStyleUrl) return;
      activeStyleUrl = next;
      courseReady = false;
      map.setStyle(next);
    },
    update(state, opts) {
      if (state.mapStyle?.url) {
        this.setBasemapUrl(state.mapStyle.url);
      }

      const participants = Object.values(state.participants);
      const selectedId = opts.selectedId;
      const hideNonSelected = opts.hideNonSelected;
      const seen = new Set<string>();

      setCourse(
        opts.courseOverride !== undefined ? opts.courseOverride : state.course
      );

      const trailFeatures: GeoJSON.Feature[] = [];

      const lbsFeatures: GeoJSON.Feature[] = [];

      for (const p of participants) {
        const ov0 = opts.positionOverrides?.[p.id];
        const hasCoords =
          Number.isFinite(ov0?.lat ?? p.athlete.lat) &&
          Number.isFinite(ov0?.lng ?? p.athlete.lng) &&
          Math.abs(ov0?.lat ?? p.athlete.lat) + Math.abs(ov0?.lng ?? p.athlete.lng) > 1e-4;
        // Presence-only stubs (0,0 / never fixed) stay off the map.
        if (!p.last_fix_ms && !hasCoords) continue;
        if (!hasCoords) continue;
        seen.add(p.id);
        const color = p.color || "#ff3b5c";
        const isSelected = p.id === selectedId;
        const visible = !hideNonSelected || isSelected;

        const rt = ensureMarker(p.id, color);
        rt.el.style.setProperty("--dot-color", color);
        rt.el.classList.toggle("selected", isSelected);
        rt.el.classList.toggle("hidden-marker", !visible);
        rt.el.classList.toggle("lbs", p.athlete?.source === "lbs");

        const flag = rt.el.querySelector(".athlete-flag") as HTMLElement | null;
        if (flag) {
          const lbsTag = p.athlete?.source === "lbs" ? " · LBS" : "";
          flag.textContent = isSelected ? `#${p.bib} ${shortName(p.name)}${lbsTag}` : "";
          flag.style.display = isSelected ? "block" : "none";
        }

        // athlete.lat/lng already snapped on server when snap is on — lerp projected points.
        const ov = opts.positionOverrides?.[p.id];
        const nextLng = ov ? ov.lng : p.athlete.lng;
        const nextLat = ov ? ov.lat : p.athlete.lat;
        const targetMoved =
          Math.abs(nextLng - rt.targetLng) > LERP_EPSILON ||
          Math.abs(nextLat - rt.targetLat) > LERP_EPSILON;
        if (targetMoved) {
          const now = performance.now();
          if (rt.lastTargetUpdateMs > 0) {
            const gap = now - rt.lastTargetUpdateMs;
            // >15s = reconnect/sleep gap — skip for T estimate
            if (gap > 0 && gap <= MAX_INTERVAL_FOR_T_MS) {
              rt.intervalSamples.push(gap);
              if (rt.intervalSamples.length > INTERVAL_WINDOW) {
                rt.intervalSamples.shift();
              }
            }
          }
          rt.lastTargetUpdateMs = now;
          rt.lerpMs = lerpMsFromIntervals(rt.intervalSamples);
          rt.targetLng = nextLng;
          rt.targetLat = nextLat;
        }
        const dLng = Math.abs(rt.targetLng - rt.displayLng);
        const dLat = Math.abs(rt.targetLat - rt.displayLat);
        if (dLng > LERP_EPSILON || dLat > LERP_EPSILON) {
          startOrRestartLerp(rt);
        }

        if (opts.showTrails !== false && visible && p.trail.length >= 2) {
          trailFeatures.push({
            type: "Feature",
            properties: { color, id: p.id, selected: isSelected ? 1 : 0 },
            geometry: {
              type: "LineString",
              coordinates: p.trail.map((pt) => [pt.lng, pt.lat]),
            },
          });
        }

        if (visible && p.athlete?.source === "lbs") {
          const rangeM =
            typeof p.athlete.lbs_range_m === "number" && p.athlete.lbs_range_m > 50
              ? Math.min(p.athlete.lbs_range_m, 8000)
              : 1200;
          lbsFeatures.push({
            type: "Feature",
            properties: {
              kind: "accuracy",
              id: p.id,
              match: p.athlete.lbs_match || "lac",
            },
            geometry: {
              type: "Polygon",
              coordinates: [circlePolygon(nextLng, nextLat, rangeM)],
            },
          });
          lbsFeatures.push({
            type: "Feature",
            properties: { kind: "center", id: p.id },
            geometry: { type: "Point", coordinates: [nextLng, nextLat] },
          });
        }
      }

      for (const [id, rt] of markers) {
        if (!seen.has(id)) {
          if (rt.rafId) cancelAnimationFrame(rt.rafId);
          rt.marker.remove();
          markers.delete(id);
        }
      }

      lastTrailFc = { type: "FeatureCollection", features: trailFeatures };
      const trailsSrc = map.getSource("trails") as maplibregl.GeoJSONSource | undefined;
      trailsSrc?.setData(lastTrailFc);

      lastLbsFc = { type: "FeatureCollection", features: lbsFeatures };
      const lbsSrc = map.getSource("lbs") as maplibregl.GeoJSONSource | undefined;
      lbsSrc?.setData(lastLbsFc);

      if (followSelected && selectedId) {
        const sel = state.participants[selectedId];
        if (sel) {
          const ov = opts.positionOverrides?.[selectedId];
          const destLng = ov ? ov.lng : sel.athlete.lng;
          const destLat = ov ? ov.lat : sel.athlete.lat;
          if (Number.isFinite(destLng) && Number.isFinite(destLat) && Math.abs(destLat) + Math.abs(destLng) > 1e-4) {
            const center = map.getCenter();
            const far =
              Math.abs(center.lng - destLng) + Math.abs(center.lat - destLat) > 0.15;
            if (!cameraFitted || far) {
              cameraFitted = true;
              map.jumpTo({ center: [destLng, destLat], zoom: Math.max(map.getZoom(), 14) });
            } else {
              const selRt = markers.get(selectedId);
              map.easeTo({
                center: [destLng, destLat],
                duration: selRt?.lerpMs ?? DEFAULT_LERP_MS,
              });
            }
          }
        }
      }
    },
  };
}

function shortName(name: string): string {
  return name.length > 12 ? name.slice(0, 11) + "…" : name;
}

function emptyLine(): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: [] },
  };
}

/** Approximate geodesic ring in WGS84, returned as a closed LinearRing. */
function circlePolygon(lng: number, lat: number, radiusM: number, steps = 64): [number, number][] {
  const R = 6378137;
  const ring: [number, number][] = [];
  const latRad = (lat * Math.PI) / 180;
  for (let i = 0; i <= steps; i++) {
    const br = (2 * Math.PI * i) / steps;
    const dLat = (radiusM * Math.cos(br)) / R;
    const dLng = (radiusM * Math.sin(br)) / (R * Math.cos(latRad));
    ring.push([lng + (dLng * 180) / Math.PI, lat + (dLat * 180) / Math.PI]);
  }
  return ring;
}
