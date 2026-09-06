import { WebSocketServer, WebSocket } from "ws";
import type { Telemetry } from "../../../packages/schema/src/telemetry.ts";

export type TrailPoint = { lat: number; lng: number; alt_baro: number; ts: number };

export type OverlayState = {
  athlete: Telemetry;
  trail: TrailPoint[];
};

export function createWsServer(port = 8787) {
  const wss = new WebSocketServer({ port });
  let latest: OverlayState | null = null;

  const broadcast = (state: OverlayState) => {
    latest = state;
    const msg = JSON.stringify(state);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  };

  wss.on("connection", (socket) => {
    if (latest) socket.send(JSON.stringify(latest));
  });

  console.log(`[ws] listening on ws://localhost:${port}`);
  return { broadcast, wss };
}
