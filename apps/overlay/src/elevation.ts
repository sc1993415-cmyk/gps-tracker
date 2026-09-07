import { connectOverlayWs, type OverlayState, type Participant } from "./ws";

const canvas = document.querySelector("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

function parseParams() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  const q = new URLSearchParams(hash || location.search);
  return {
    selected: q.get("selected"),
    selectedStartNumber: q.get("selectedStartNumber") || q.get("startNumber"),
    ws: q.get("ws") || "ws://localhost:8787",
  };
}

const params = parseParams();

function pickParticipant(state: OverlayState): Participant | null {
  const list = Object.values(state.participants);
  if (!list.length) return null;
  if (params.selected && state.participants[params.selected]) {
    return state.participants[params.selected]!;
  }
  if (params.selectedStartNumber) {
    const byBib = list.find((p) => p.bib === params.selectedStartNumber);
    if (byBib) return byBib;
  }
  return list[0]!;
}

function draw(alts: number[], progressIdx: number) {
  const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
  const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
  ctx.clearRect(0, 0, w, h);
  if (alts.length < 2) return;
  const min = Math.min(...alts);
  const max = Math.max(...alts);
  const span = Math.max(1, max - min);
  ctx.beginPath();
  alts.forEach((alt, i) => {
    const x = (i / (alts.length - 1)) * w;
    const y = h - ((alt - min) / span) * (h - 20) - 10;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#7CFFB2";
  ctx.lineWidth = 3 * devicePixelRatio;
  ctx.stroke();
  const i = Math.min(progressIdx, alts.length - 1);
  const x = (i / (alts.length - 1)) * w;
  const y = h - ((alts[i]! - min) / span) * (h - 20) - 10;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(x, y, 6 * devicePixelRatio, 0, Math.PI * 2);
  ctx.fill();
}

connectOverlayWs(params.ws, (state) => {
  const p = pickParticipant(state);
  const alts = (p?.trail ?? []).map((pt) => pt.alt_baro);
  draw(alts, Math.max(0, alts.length - 1));
});
