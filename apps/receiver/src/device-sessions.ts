import type net from "node:net";

/** Live TCP sockets keyed by device_id (H02 / MT909). */
const sockets = new Map<string, net.Socket>();
/** Commands waiting for the device to reconnect. */
const pending = new Map<string, string[]>();

export type CmdReceiptStatus = "queued" | "waiting" | "ack" | "timeout";

export type CommandReceipt = {
  id: string;
  device_id: string;
  command: string;
  /** When the admin/API accepted the send (ms). */
  created_ms: number;
  /** When bytes were written to TCP (ms), if ever. */
  written_ms?: number;
  /** When a text reply was attached (ms). */
  reply_ms?: number;
  reply?: string;
  status: CmdReceiptStatus;
  queued: boolean;
};

const MAX_RECEIPTS = 20;
/** No plaintext reply within this window → status timeout (not hard failure). */
const ACK_TIMEOUT_MS = 90_000;

const receipts: CommandReceipt[] = [];
let receiptSeq = 0;

function refreshReceiptStatuses(now = Date.now()) {
  for (const r of receipts) {
    if (r.status === "waiting" && r.written_ms != null && now - r.written_ms > ACK_TIMEOUT_MS) {
      r.status = "timeout";
    }
  }
}

function pushReceipt(r: CommandReceipt) {
  receipts.unshift(r);
  while (receipts.length > MAX_RECEIPTS) receipts.pop();
}

function markWritten(deviceId: string, raw: string, now = Date.now()) {
  // Prefer oldest matching queued/waiting without write for this device+command.
  const hit =
    [...receipts]
      .reverse()
      .find(
        (r) =>
          r.device_id === deviceId &&
          r.command === raw &&
          r.written_ms == null &&
          (r.status === "queued" || r.status === "waiting")
      ) ?? null;
  if (hit) {
    hit.written_ms = now;
    hit.status = "waiting";
    hit.queued = false;
    return hit;
  }
  // Orphan flush (shouldn't happen often): still record.
  const r: CommandReceipt = {
    id: `cmd-${++receiptSeq}`,
    device_id: deviceId,
    command: raw,
    created_ms: now,
    written_ms: now,
    status: "waiting",
    queued: false,
  };
  pushReceipt(r);
  return r;
}

export function listCommandReceipts(): CommandReceipt[] {
  refreshReceiptStatuses();
  return receipts.map((r) => ({ ...r }));
}

export function bindDeviceSocket(deviceId: string, socket: net.Socket) {
  if (!deviceId) return;
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
  if (!deviceId) return;
  refreshReceiptStatuses();
  // Attach to oldest waiting command for this device (FIFO).
  const hit = [...receipts]
    .reverse()
    .find((r) => r.device_id === deviceId && r.status === "waiting" && !r.reply);
  if (hit) {
    hit.reply = t;
    hit.reply_ms = Date.now();
    hit.status = "ack";
  }
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
    markWritten(deviceId, raw);
  }
}

/** Write MT909 SMS-style command on the live TCP socket (or queue if offline). */
export function sendRawCommand(
  deviceId: string,
  raw: string
): { ok: true; queued: boolean; receipt: CommandReceipt } | { ok: false; error: string } {
  const text = raw.trim();
  if (!deviceId) return { ok: false, error: "device_id required" };
  if (!text) return { ok: false, error: "empty command" };

  const now = Date.now();
  const receipt: CommandReceipt = {
    id: `cmd-${++receiptSeq}`,
    device_id: deviceId,
    command: text,
    created_ms: now,
    status: "queued",
    queued: true,
  };

  const s = sockets.get(deviceId);
  if (s && !s.destroyed && s.writable) {
    console.log(`[cmd] send id=${deviceId} raw=${JSON.stringify(text)}`);
    s.write(text);
    receipt.queued = false;
    receipt.written_ms = now;
    receipt.status = "waiting";
    pushReceipt(receipt);
    return { ok: true, queued: false, receipt };
  }

  const q = pending.get(deviceId) ?? [];
  if (q.length >= 20) return { ok: false, error: "pending queue full" };
  q.push(text);
  pending.set(deviceId, q);
  console.log(`[cmd] queued id=${deviceId} raw=${JSON.stringify(text)}`);
  pushReceipt(receipt);
  return { ok: true, queued: true, receipt };
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
    // Vendor says 1s is supported; handbook said 10–3599 — allow ≥1 for livestream.
    if (!Number.isFinite(t) || t < 1 || t > 3599) {
      throw new Error("FREQ interval must be 1–3599 seconds");
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
