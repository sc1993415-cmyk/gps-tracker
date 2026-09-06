import { createWsServer } from "./ws-server.ts";
import { pushTrailPoint } from "./downsample.ts";
import { startDemoPublisher } from "./demo-publisher.ts";
import { startMt909TcpServer } from "./mt909-tcp.ts";
import type { TrailPoint } from "./ws-server.ts";
import type { Telemetry } from "../../../packages/schema/src/telemetry.ts";

const demo = process.argv.includes("--demo");

const { broadcast } = createWsServer(Number(process.env.WS_PORT) || 8787);
const trail: TrailPoint[] = [];

function onTelemetry(athlete: Telemetry) {
  pushTrailPoint(trail, {
    lat: athlete.lat,
    lng: athlete.lng,
    alt_baro: athlete.alt_baro,
    ts: athlete.ts,
  });
  broadcast({ athlete, trail: [...trail] });
}

if (demo) {
  console.log("[demo] publishing ~1Hz fake telemetry");
  startDemoPublisher(onTelemetry);
} else {
  // Default non-demo path (or explicit --mt909): Mictrack MT909 TCP
  const port = Number(process.env.MT909_TCP_PORT) || 5013;
  console.log(`[mt909] starting TCP adapter (port ${port})`);
  startMt909TcpServer(onTelemetry, port);
}

// mqtt.ts 可先留空占位
