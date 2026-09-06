import { createWsServer } from "./ws-server.ts";
import { pushTrailPoint } from "./downsample.ts";
import { startDemoPublisher } from "./demo-publisher.ts";
import type { TrailPoint } from "./ws-server.ts";

const demo = process.argv.includes("--demo");
const { broadcast } = createWsServer(Number(process.env.WS_PORT) || 8787);
const trail: TrailPoint[] = [];

if (demo) {
  console.log("[demo] publishing ~1Hz fake telemetry");
  startDemoPublisher((athlete) => {
    pushTrailPoint(trail, {
      lat: athlete.lat,
      lng: athlete.lng,
      alt_baro: athlete.alt_baro,
      ts: athlete.ts,
    });
    broadcast({ athlete, trail: [...trail] });
  });
} else {
  console.log("[receiver] MQTT mode not wired yet; run with --demo");
}

// mqtt.ts 可先留空占位
