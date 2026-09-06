import maplibregl from "maplibre-gl";
import type { OverlayState, TrailPoint } from "./ws";

const STYLE = "https://demotiles.maplibre.org/style.json";

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

  return {
    update(state: OverlayState) {
      const { lat, lng } = state.athlete;
      marker.setLngLat([lng, lat]);
      const src = map.getSource("trail") as maplibregl.GeoJSONSource | undefined;
      src?.setData(lineFromTrail(state.trail));
      map.easeTo({ center: [lng, lat], duration: 400 });
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
