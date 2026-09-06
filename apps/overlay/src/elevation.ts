import { connectOverlayWs } from "./ws";

const canvas = document.querySelector("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

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
  const y = h - ((alts[i] - min) / span) * (h - 20) - 10;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(x, y, 6 * devicePixelRatio, 0, Math.PI * 2);
  ctx.fill();
}

connectOverlayWs("ws://localhost:8787", (state) => {
  const alts = state.trail.map((p) => p.alt_baro);
  draw(alts, alts.length - 1);
});
