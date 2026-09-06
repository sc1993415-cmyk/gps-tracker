import maplibregl from "maplibre-gl";
import type { OverlayState, TrailPoint } from "./ws";

const STYLE = "https://demotiles.maplibre.org/style.json";

/** Duration (ms) to lerp the athlete marker between WebSocket updates. */
const MARKER_LERP_MS = 900;
/** Stop the rAF loop once within this many degrees of the target (~1 cm at equator). */
const LERP_EPSILON = 1e-7;

export function createMap(container: string) {
  const map = new maplibregl.Map({
    container,
    style: STYLE,
    center: [121.4737, 31.2304],
    zoom: 14,
    attributionControl: false,
  });

  const markerEl = document.createElement("div");
  markerEl.className = "athlete-dot";
  const marker = new maplibregl.Marker({ element: markerEl })
    .setLngLat([121.4737, 31.2304])
    .addTo(map);

  map.on("load", () => {
    map.addSource("trail", {
      type: "geojson",
      data: emptyLine(),
    });
    map.addLayer({
      id: "trail-line",
      type: "line",
      source: "trail",
      paint: { "line-color": "#00e5ff", "line-width": 4 },
    });
  });

  // Displayed (smoothed) position vs latest WebSocket target.
  let displayLng = 121.4737;
  let displayLat = 31.2304;
  let targetLng = displayLng;
  let targetLat = displayLat;
  let lerpFromLng = displayLng;
  let lerpFromLat = displayLat;
  let lerpStartMs = 0;
  let rafId = 0;

  function tick(now: number) {
    const t = Math.min(1, (now - lerpStartMs) / MARKER_LERP_MS);
    // Ease-out cubic for a natural deceleration into the target.
    const eased = 1 - (1 - t) ** 3;
    displayLng = lerpFromLng + (targetLng - lerpFromLng) * eased;
    displayLat = lerpFromLat + (targetLat - lerpFromLat) * eased;
    marker.setLngLat([displayLng, displayLat]);

    if (t < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      displayLng = targetLng;
      displayLat = targetLat;
      marker.setLngLat([displayLng, displayLat]);
      rafId = 0;
    }
  }

  function startOrRestartLerp() {
    lerpFromLng = displayLng;
    lerpFromLat = displayLat;
    lerpStartMs = performance.now();
    if (!rafId) {
      rafId = requestAnimationFrame(tick);
    }
  }

  return {
    update(state: OverlayState) {
      const { lat, lng } = state.athlete;
      targetLng = lng;
      targetLat = lat;

      // Trail updates immediately on each state; marker eases via rAF.
      const src = map.getSource("trail") as maplibregl.GeoJSONSource | undefined;
      src?.setData(lineFromTrail(state.trail));

      const dLng = Math.abs(targetLng - displayLng);
      const dLat = Math.abs(targetLat - displayLat);
      if (dLng > LERP_EPSILON || dLat > LERP_EPSILON) {
        startOrRestartLerp();
      }

      map.easeTo({ center: [lng, lat], duration: MARKER_LERP_MS });
    },
  };
}

function emptyLine(): GeoJSON.Feature {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } };
}

function lineFromTrail(trail: TrailPoint[]): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: trail.map((p) => [p.lng, p.lat]),
    },
  };
}
