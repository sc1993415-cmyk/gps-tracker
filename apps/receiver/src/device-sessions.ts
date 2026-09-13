import type net from "node:net";

/** Live TCP sockets keyed by device_id (H02 / MT909). */
const sockets = new Map<string, net.Socket>();
/** Commands waiting for the device to reconnect. */
const pending = new Map<string, string[]>();

export function bindDeviceSocket(deviceId: string, socket: net.Socket) {
  if (!deviceId) return;
  const prev = sockets.get(deviceId);
  if (prev && prev !== socket && !prev.destroyed) {
    // Newer connection wins.
  }
  sockets.set(deviceId, socket);
  flushPending(deviceId);
}

export function unbindSocket(socket: net.Socket) {
  for (const [id, s] of sockets) {
    if (s === socket) sockets.delete(id);
  }
}

export function isDeviceOnline(deviceId: string): boolean {
  const s = sockets.get(deviceId);
  return !!(s && !s.destroyed && s.writable);
}

export function listOnlineDevices(): string[] {
  return [...sockets.keys()].filter(isDeviceOnline);
}

export function noteDeviceReply(deviceId: string | null | undefined, text: string) {
  const t = text.replace(/\r/g, "").trim();
  if (!t) return;
  console.log(`[cmd] reply id=${deviceId || "?"} raw=${JSON.stringify(t)}`);
}

function flushPending(deviceId: string) {
  const s = sockets.get(deviceId);
  if (!s || s.destroyed || !s.writable) return;
  const q = pending.get(deviceId);
  if (!q?.length) return;
  pending.set(deviceId, []);
  for (const raw of q) {
    console.log(`[cmd] flush id=${deviceId} raw=${JSON.stringify(raw)}`);
    s.write(raw);
  }
}

/** Write MT909 SMS-style command on the live TCP socket (or queue if offline). */
export function sendRawCommand(
  deviceId: string,
  raw: string
): { ok: true; queued: boolean } | { ok: false; error: string } {
  const text = raw.trim();
  if (!deviceId) return { ok: false, error: "device_id required" };
  if (!text) return { ok: false, error: "empty command" };

  const s = sockets.get(deviceId);
  if (s && !s.destroyed && s.writable) {
    console.log(`[cmd] send id=${deviceId} raw=${JSON.stringify(text)}`);
    s.write(text);
    return { ok: true, queued: false };
  }

  const q = pending.get(deviceId) ?? [];
  if (q.length >= 20) return { ok: false, error: "pending queue full" };
  q.push(text);
  pending.set(deviceId, q);
  console.log(`[cmd] queued id=${deviceId} raw=${JSON.stringify(text)}`);
  return { ok: true, queued: true };
}

export type Mt909CmdKind = "freq" | "ip" | "cq";

export type Mt909CmdParams = {
  password?: string;
  intervalSec?: number;
  host?: string;
  port?: number;
};

/** Build official MT909 SMS command strings (handbook V1.0). */
export function buildMt909Command(
  kind: Mt909CmdKind,
  params: Mt909CmdParams = {}
): string {
  if (kind === "cq") return "CQ";

  if (kind === "freq") {
    const password = (params.password ?? "123456").trim() || "123456";
    const t = Number(params.intervalSec ?? 30);
    if (!Number.isFinite(t) || t < 10 || t > 3599) {
      throw new Error("FREQ interval must be 10–3599 seconds");
    }
    return `FREQ,${password},${Math.floor(t)}`;
  }

  if (kind === "ip") {
    const host = (params.host ?? "").trim();
    const port = Number(params.port ?? 5013);
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      throw new Error("IP host must look like a.b.c.d");
    }
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      throw new Error("IP port must be 1–65535");
    }
    // Spaces, no password — matches handbook / Traccar custom command.
    return `IP ${host} ${Math.floor(port)}`;
  }

  throw new Error(`unknown cmd ${kind}`);
}
