import maplibregl from "maplibre-gl";
import type { OverlayState, CourseFeature } from "./ws";

const STYLE = "https://demotiles.maplibre.org/style.json";

/** Duration (ms) to lerp each athlete marker between WebSocket updates. */
const MARKER_LERP_MS = 900;
const LERP_EPSILON = 1e-7;

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
    }
  ) => void;
  setFollow: (follow: boolean) => void;
};

export function createMap(container: string): MapController {
  const map = new maplibregl.Map({
    container,
    style: STYLE,
    center: [121.4737, 31.2304],
    zoom: 14,
    attributionControl: false,
  });

  const markers = new Map<string, MarkerRuntime>();
  let followSelected = true;
  let courseReady = false;

  map.on("load", () => {
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
    courseReady = true;
  });

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
      rafId: 0,
    };
    markers.set(id, rt);
    return rt;
  }

  function tickMarker(rt: MarkerRuntime, now: number) {
    const t = Math.min(1, (now - rt.lerpStartMs) / MARKER_LERP_MS);
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
    update(state, opts) {
      const participants = Object.values(state.participants);
      const selectedId = opts.selectedId;
      const hideNonSelected = opts.hideNonSelected;
      const seen = new Set<string>();

      setCourse(
        opts.courseOverride !== undefined ? opts.courseOverride : state.course
      );

      const trailFeatures: GeoJSON.Feature[] = [];

      for (const p of participants) {
        seen.add(p.id);
        const color = p.color || "#ff3b5c";
        const isSelected = p.id === selectedId;
        const visible = !hideNonSelected || isSelected;

        const rt = ensureMarker(p.id, color);
        rt.el.style.setProperty("--dot-color", color);
        rt.el.classList.toggle("selected", isSelected);
        rt.el.classList.toggle("hidden-marker", !visible);

        const flag = rt.el.querySelector(".athlete-flag") as HTMLElement | null;
        if (flag) {
          flag.textContent = isSelected ? `#${p.bib} ${shortName(p.name)}` : "";
          flag.style.display = isSelected ? "block" : "none";
        }

        rt.targetLng = p.athlete.lng;
        rt.targetLat = p.athlete.lat;
        const dLng = Math.abs(rt.targetLng - rt.displayLng);
        const dLat = Math.abs(rt.targetLat - rt.displayLat);
        if (dLng > LERP_EPSILON || dLat > LERP_EPSILON) {
          startOrRestartLerp(rt);
        }

        if (visible && p.trail.length >= 2) {
          trailFeatures.push({
            type: "Feature",
            properties: { color, id: p.id, selected: isSelected ? 1 : 0 },
            geometry: {
              type: "LineString",
              coordinates: p.trail.map((pt) => [pt.lng, pt.lat]),
            },
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

      const trailsSrc = map.getSource("trails") as maplibregl.GeoJSONSource | undefined;
      trailsSrc?.setData({ type: "FeatureCollection", features: trailFeatures });

      if (followSelected && selectedId) {
        const sel = state.participants[selectedId];
        if (sel) {
          map.easeTo({
            center: [sel.athlete.lng, sel.athlete.lat],
            duration: MARKER_LERP_MS,
          });
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
