import "maplibre-gl/dist/maplibre-gl.css";
import { connectOverlayWs } from "./ws";
import { createMap } from "./map";

const map = createMap("map");
const flag = document.querySelector("#flag")!;
const speed = document.querySelector("#speed")!;
const distance = document.querySelector("#distance")!;
const climb = document.querySelector("#climb")!;

connectOverlayWs("ws://localhost:8787", (state) => {
  map.update(state);
  const a = state.athlete;
  flag.textContent = `#${a.bib} ${a.name}`;
  speed.textContent = `${a.speed.toFixed(1)}`;
  distance.textContent = `${(a.distance / 1000).toFixed(2)}`;
  climb.textContent = `${Math.round(a.climb)}`;
});
