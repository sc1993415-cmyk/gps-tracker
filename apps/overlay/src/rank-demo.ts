import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { connectOverlayWs, type CourseFeature, type OverlayState } from "./ws";

type Rider = {
  id: string;
  bib: string;
  name: string;
  color: string;
  s: number;
  speedMps: number;
  rank: number;
  prev: number;
  marker: maplibregl.Marker;
};

const NAMES = ["周屿", "陈可", "林川", "苏晚", "韩策", "叶澄", "顾深", "江夏", "沈北", "陆南"];
const COLORS = [
  "#ff3b5c", "#3d8bfd", "#7cffb2", "#ffd166", "#c084fc",
  "#22d3ee", "#fb7185", "#a3e635", "#f97316", "#60a5fa",
];

const listEl = document.getElementById("list")!;
const noteEl = document.getElementById("note")!;

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLng = r(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

type Track = {
  pts: { lng: number; lat: number }[];
  cum: number[];
  total: number;
};

function buildTrack(course: CourseFeature): Track | null {
  const raw = course.geometry?.coordinates;
  if (!raw || raw.length < 2) return null;
  const pts = raw.map((c) => ({ lng: c[0], lat: c[1] }));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1]! + haversineM(pts[i - 1]!.lat, pts[i - 1]!.lng, pts[i]!.lat, pts[i]!.lng));
  }
  return { pts, cum, total: cum[cum.length - 1]! };
}

function pointAtS(track: Track, s: number): { lng: number; lat: number } {
  const { pts, cum, total } = track;
  if (total <= 0) return pts[0]!;
  let x = Math.max(0, Math.min(s, total));
  let i = 1;
  while (i < cum.length && cum[i]! < x) i++;
  const i0 = Math.max(0, i - 1);
  const i1 = Math.min(pts.length - 1, i);
  const span = cum[i1]! - cum[i0]!;
  const t = span > 0 ? (x - cum[i0]!) / span : 0;
  return {
    lng: pts[i0]!.lng + (pts[i1]!.lng - pts[i0]!.lng) * t,
    lat: pts[i0]!.lat + (pts[i1]!.lat - pts[i0]!.lat) * t,
  };
}

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/positron",
  center: [118.78, 32.06],
  zoom: 13,
  attributionControl: true,
});

let track: Track | null = null;
let riders: Rider[] = [];
let finish: { lat: number; lng: number } | null = null;
let last = performance.now();
let acc = 0;
let started = false;

function paintCourse(course: CourseFeature) {
  const src = map.getSource("course") as maplibregl.GeoJSONSource | undefined;
  const fc = { type: "FeatureCollection" as const, features: [course] };
  if (src) src.setData(fc as GeoJSON.GeoJSON);
  else {
    map.addSource("course", { type: "geojson", data: fc as GeoJSON.GeoJSON });
    map.addLayer({
      id: "course-line",
      type: "line",
      source: "course",
      paint: { "line-color": "#ff3b5c", "line-width": 4, "line-opacity": 0.9 },
    });
  }
}

function fitCourse(course: CourseFeature) {
  const b = new maplibregl.LngLatBounds();
  for (const c of course.geometry.coordinates) b.extend([c[0], c[1]]);
  map.fitBounds(b, { padding: 72, duration: 0, maxZoom: 16 });
}

function renderList() {
  const rows = [...riders].sort((a, b) => a.rank - b.rank);
  listEl.innerHTML = rows
    .map((r) => {
      const pt = track ? pointAtS(track, r.s) : { lat: 0, lng: 0 };
      const d = finish ? haversineM(pt.lat, pt.lng, finish.lat, finish.lng) : 0;
      const arrow = r.rank < r.prev ? "up" : r.rank > r.prev ? "down" : "flat";
      const glyph = arrow === "up" ? "▲" : arrow === "down" ? "▼" : "–";
      return `<div class="row ${arrow}">
        <span class="rank"><span class="arrow ${arrow}">${glyph}</span>${r.rank}</span>
        <span style="width:10px;height:10px;border-radius:50%;background:${r.color}"></span>
        <span class="name">${r.name}<small>#${r.bib}</small></span>
        <span class="dist">${(d / 1000).toFixed(2)} km</span>
      </div>`;
    })
    .join("");
}

function rankNow() {
  if (!track || !finish) return;
  const scored = riders.map((r) => {
    const pt = pointAtS(track!, r.s);
    return { r, d: haversineM(pt.lat, pt.lng, finish!.lat, finish!.lng) };
  });
  scored.sort((a, b) => a.d - b.d);
  scored.forEach((row, i) => {
    row.r.prev = row.r.rank;
    row.r.rank = i + 1;
  });
}

function spawn(course: CourseFeature) {
  riders.forEach((r) => r.marker.remove());
  riders = [];
  track = buildTrack(course);
  if (!track || track.total < 20) {
    noteEl.textContent = "赛道太短，无法模拟";
    return;
  }
  const last = course.geometry.coordinates[course.geometry.coordinates.length - 1]!;
  finish = { lng: last[0], lat: last[1] };
  paintCourse(course);
  fitCourse(course);
  for (let i = 0; i < 10; i++) {
    const el = document.createElement("div");
    el.className = "athlete-sim";
    el.style.background = COLORS[i]!;
    const s0 = track.total * (0.02 + i * 0.015 + Math.random() * 0.03);
    const marker = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat(pointAtS(track, s0))
      .addTo(map);
    riders.push({
      id: String(i + 1),
      bib: String(101 + i),
      name: NAMES[i]!,
      color: COLORS[i]!,
      s: s0,
      speedMps: 4.2 + i * 0.35 + Math.random() * 1.8,
      rank: i + 1,
      prev: i + 1,
      marker,
    });
  }
  rankNow();
  renderList();
  noteEl.textContent = `吸附 GPX · ${(track.total / 1000).toFixed(2)} km · 直线距终点排名`;
  started = true;
}

function tick(now: number) {
  requestAnimationFrame(tick);
  if (!started || !track) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  acc += dt;
  for (const r of riders) {
    r.s += r.speedMps * dt;
    if (r.s >= track.total) r.s = track.total * 0.02;
    r.marker.setLngLat(pointAtS(track, r.s));
  }
  if (acc > 0.6) {
    acc = 0;
    rankNow();
    renderList();
  }
}

function applyState(state: OverlayState) {
  if (state.mapStyle?.url && map.getStyle && state.mapStyle.url) {
    const url = state.mapStyle.url;
    const cur = (map.getStyle() as { sprite?: string } | undefined);
    if (!String(map.getCanvas()?.dataset.style || "").includes(url)) {
      map.getCanvas().dataset.style = url;
      map.setStyle(url);
      map.once("style.load", () => {
        if (state.course) paintCourse(state.course);
      });
    }
  }
  if (state.course?.geometry?.coordinates?.length && !started) {
    spawn(state.course);
  }
}

map.on("load", () => {
  const ws = `ws://${location.hostname}:8787`;
  connectOverlayWs(ws, applyState);
  fetch("/course.geojson", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      if (started || !json) return;
      const course =
        json?.type === "Feature" ? json : json?.features?.find((f: CourseFeature) => f?.geometry?.type === "LineString");
      if (course) spawn(course as CourseFeature);
    })
    .catch(() => {});
  requestAnimationFrame(tick);
});
