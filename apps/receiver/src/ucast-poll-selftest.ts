import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ucast-poll-"));
const configPath = path.join(tmp, "ucast.json");
process.env.UCAST_CONFIG_PATH = configPath;

const wss = new WebSocketServer({ port: 0 });
await new Promise<void>((resolve) => wss.once("listening", resolve));
const address = wss.address();
assert(address && typeof address === "object");

let active = 0;
let maxActive = 0;
let connections = 0;
const requests: string[] = [];
const sockets = new Set<WebSocket>();
const socketBySn = new Map<string, WebSocket>();

function decodeRequest(data: Buffer): { key: string; content: unknown } {
  const keyLength = data[1] ?? 0;
  return {
    key: data.subarray(8, 8 + keyLength).toString("utf8"),
    content: JSON.parse(data.subarray(8 + keyLength).toString("utf8")),
  };
}

function encodeTick(sn: string): Buffer {
  const key = Buffer.from("device/gps/tick", "utf8");
  const content = Buffer.from(
    JSON.stringify({
      sn,
      gps: {
        error: 0,
        longitude: 118_741_960,
        latitude: 32_048_110,
        altitude: 42,
        speed: 12.5,
        direction: 87,
      },
    }),
    "utf8"
  );
  const frame = Buffer.alloc(8 + key.length + content.length);
  frame[0] = 1;
  frame[1] = key.length;
  frame.writeUInt32BE(1, 4);
  key.copy(frame, 8);
  content.copy(frame, 8 + key.length);
  return frame;
}

wss.on("connection", (socket) => {
  connections++;
  active++;
  maxActive = Math.max(maxActive, active);
  sockets.add(socket);
  socket.on("message", (data) => {
    const msg = decodeRequest(Buffer.from(data as ArrayBuffer));
    if (msg.key === "device/gps/continuous") {
      const sn = String((msg.content as { sn?: string }).sn || "");
      requests.push(sn);
      socketBySn.set(sn, socket);
    }
  });
  socket.on("close", () => {
    active--;
    sockets.delete(socket);
  });
});

const originalFetch = globalThis.fetch;
let blockNextLogin = false;
let blockedLoginAborted = false;
globalThis.fetch = async (_input, init) => {
  if (blockNextLogin) {
    blockNextLogin = false;
    return await new Promise<Response>((_resolve, reject) => {
      const abort = () => {
        blockedLoginAborted = true;
        reject(new DOMException("aborted", "AbortError"));
      };
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    });
  }
  return new Response(JSON.stringify({ error: 0, user: { token: "test-token" } }), {
    headers: { "content-type": "application/json" },
  });
};

const writeConfig = (enabled: boolean, sn: string) =>
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      enabled,
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: "fixture-key",
      loginname: "fixture-user",
      password: "fixture-password",
      devices: [{ sn, device_id: sn }],
    })
  );

const eventually = async (condition: () => boolean, label: string) => {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timeout: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

try {
  const { restartUcastPoller, startUcastPoller, getUcastPublicConfig } =
    await import("./ucast-poll.ts");

  const fixes: string[] = [];
  writeConfig(true, "BLOCKED-LOGIN-SN");
  blockNextLogin = true;
  startUcastPoller((fix) => fixes.push(fix.device_id));
  await new Promise((resolve) => setTimeout(resolve, 25));

  writeConfig(true, "OLD-SN");
  restartUcastPoller();
  await eventually(() => blockedLoginAborted, "restart aborts in-flight login");
  await eventually(() => requests.includes("OLD-SN"), "first poll request");

  for (const sn of ["NEW-SN-1", "NEW-SN-2", "CURRENT-SN"]) {
    writeConfig(true, sn);
    restartUcastPoller();
    await eventually(() => requests.includes(sn), `request ${sn}`);
    await eventually(() => active === 1, `single active socket after ${sn}`);
  }

  assert.equal(maxActive, 1, "restarts must never overlap websocket sessions");
  assert.equal(getUcastPublicConfig().running, true);

  socketBySn.get("CURRENT-SN")?.send(encodeTick("CURRENT-SN"));
  await eventually(() => fixes.includes("CURRENT-SN"), "tick reaches onFix");

  const oldSocket = socketBySn.get("CURRENT-SN");
  const fixesBeforeRestart = fixes.length;
  oldSocket?.send(encodeTick("CURRENT-SN"));
  writeConfig(true, "FINAL-SN");
  restartUcastPoller();
  await eventually(() => requests.includes("FINAL-SN"), "final replacement request");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(fixes.length, fixesBeforeRestart, "stopped poller must suppress queued old ticks");
  await eventually(() => active === 1, "single active final socket");

  writeConfig(false, "FINAL-SN");
  restartUcastPoller();
  await eventually(() => active === 0, "disable closes active websocket");
  const connectionsAfterDisable = connections;
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(connections, connectionsAfterDisable, "disabled poller must not reconnect");
  assert.equal(getUcastPublicConfig().running, false);

  console.log("ucast poll lifecycle selftest: OK");
} finally {
  globalThis.fetch = originalFetch;
  for (const socket of sockets) socket.terminate();
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  fs.rmSync(tmp, { recursive: true, force: true });
}
