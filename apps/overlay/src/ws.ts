export type TrailPoint = { lat: number; lng: number; alt_baro: number; ts: number };
export type Telemetry = {
  device_id: string; lat: number; lng: number; speed: number; alt_baro: number;
  ts: number; bib: string; name: string; distance: number; climb: number;
};
export type OverlayState = { athlete: Telemetry; trail: TrailPoint[] };

export function connectOverlayWs(
  url = "ws://localhost:8787",
  onState: (s: OverlayState) => void
) {
  let retry = 0;
  const connect = () => {
    const ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      try { onState(JSON.parse(String(ev.data))); } catch {}
    };
    ws.onclose = () => {
      const wait = Math.min(5000, 500 * 2 ** retry++);
      setTimeout(connect, wait);
    };
    ws.onopen = () => { retry = 0; };
  };
  connect();
}
