/**
 * Ucast cloud GPS poller (apiv3 websocket).
 * Device does not push to :5013 — VPS logs in and pulls ticks.
 *
 * Config: apps/receiver/data/ucast.json  (copy from ucast.example.json)
 * Env overrides: UCAST_LOGIN UCAST_PASSWORD UCAST_SN UCAST_ENABLED=1
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import type { Telemetry } from "../../../packages/schema/src/telemetry.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UCAST_PATH = path.resolve(
  process.env.UCAST_CONFIG_PATH || path.resolve(__dirname, "../data/ucast.json")
);

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

type UcastDevice = { sn: string; device_id?: string };
type UcastConfig = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  loginname: string;
  password: string;
  devices: UcastDevice[];
};

type GpsTick = {
  error?: number;
  longitude: number;
  latitude: number;
  altitude?: number;
  speed?: number;
  direction?: number;
};

function loadConfig(): UcastConfig {
  let file: Partial<UcastConfig> = {};
  try {
    if (fs.existsSync(UCAST_PATH)) {
      file = JSON.parse(fs.readFileSync(UCAST_PATH, "utf8") || "{}");
    }
  } catch (err) {
    console.warn("[ucast] config read failed", err);
  }
  const loginname = process.env.UCAST_LOGIN || String(file.loginname || "").trim();
  const password = process.env.UCAST_PASSWORD || String(file.password || "");
  const envSn = String(process.env.UCAST_SN || "").trim();
  const devices: UcastDevice[] = envSn
    ? [{ sn: envSn, device_id: process.env.UCAST_DEVICE_ID || envSn }]
    : Array.isArray(file.devices)
      ? file.devices.filter((d) => d && d.sn)
      : [];
  const enabledEnv = process.env.UCAST_ENABLED;
  const enabled =
    enabledEnv === "1" || enabledEnv === "true"
      ? true
      : enabledEnv === "0" || enabledEnv === "false"
        ? false
        : file.enabled === true;
  return {
    enabled,
    baseUrl: String(file.baseUrl || "https://api.ucastcn.com").replace(/\/$/, ""),
    apiKey: String(file.apiKey || "65665c6cc310aa782a4fffaf01863d4e"),
    loginname,
    password,
    devices,
  };
}

function isPlaceholder(s: string): boolean {
  const v = s.trim();
  if (!v) return true;
  return /你的|手机号|密码|设备SN|example/i.test(v);
}

export function getUcastPublicConfig() {
  const c = loadConfig();
  const login = isPlaceholder(c.loginname) ? "" : c.loginname;
  const devices = c.devices.filter((d) => d.sn && !isPlaceholder(d.sn));
  return {
    enabled: c.enabled,
    baseUrl: c.baseUrl,
    loginname: login,
    hasPassword: !!(c.password && !isPlaceholder(c.password)),
    devices,
    running: pollerRunning(),
  };
}

export function saveUcastConfig(body: Record<string, unknown>) {
  const cur = loadConfig();
  const loginname =
    typeof body.loginname === "string" ? body.loginname.trim() : cur.loginname;
  let password = cur.password;
  if (typeof body.password === "string" && body.password.trim()) {
    password = body.password;
  }
  let devices = cur.devices;
  if (Array.isArray(body.devices)) {
    devices = (body.devices as UcastDevice[])
      .map((d) => ({
        sn: String(d?.sn || "").trim(),
        device_id: String(d?.device_id || "").trim(),
      }))
      .filter((d) => d.sn);
  } else if (typeof body.sns === "string") {
    devices = String(body.sns)
      .split(/[\n,;]+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sn, id] = line.split(/\s+/);
        return { sn: (sn || "").trim(), device_id: (id || "").trim() };
      })
      .filter((d) => d.sn);
  }
  const enabled =
    body.enabled === true || body.enabled === "true" || body.enabled === 1;
  const next: UcastConfig = {
    enabled,
    baseUrl: cur.baseUrl,
    apiKey: cur.apiKey,
    loginname,
    password,
    devices,
  };
  fs.mkdirSync(path.dirname(UCAST_PATH), { recursive: true });
  fs.writeFileSync(UCAST_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
  console.log(`[ucast] saved enabled=${enabled} sns=${devices.map((d) => d.sn).join(",")}`);
  restartUcastPoller();
  return getUcastPublicConfig();
}

let onFixRef: ((t: Telemetry) => void) | null = null;
let stopCurrent: (() => void) | null = null;

function pollerRunning() {
  return !!stopCurrent;
}

export function restartUcastPoller() {
  if (stopCurrent) {
    stopCurrent();
  }
  if (onFixRef) bootPoller(onFixRef);
}

function randomBase62(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += BASE62[crypto.randomInt(62)];
  return s;
}

function genNonce(): string {
  return randomBase62(8) + String(Math.floor(Date.now() / 1000));
}

function genProof(istr: string): string {
  const indexes = [0, crypto.randomInt(62), 0, crypto.randomInt(62), 0, 0];
  const chars = indexes.map((i) => BASE62[i]!);
  for (let iter = 0; iter < 1 << 22; iter++) {
    for (let i = 5; i >= 0; i--) {
      indexes[i]!++;
      if (indexes[i]! < 62) {
        chars[i] = BASE62[indexes[i]!]!;
        break;
      }
      indexes[i] = 0;
      chars[i] = BASE62[0]!;
    }
    const rd = chars.join("");
    const hash = crypto.createHash("sha256").update(`${istr}:${rd}`).digest();
    if (hash[30] === 0 && hash[31] === 0) return rd;
  }
  throw new Error("ucast proof generation failed");
}

class WsMsg {
  direction = 0;
  error = 0;
  seq = 0;
  key = "";
  content = Buffer.alloc(0);

  encode(): Buffer {
    const keyBuf = Buffer.from(this.key, "utf8");
    if (keyBuf.length > 255) throw new Error("ucast key too long");
    const buf = Buffer.alloc(8 + keyBuf.length + this.content.length);
    buf[0] = this.direction & 1;
    buf[1] = keyBuf.length;
    buf.writeUInt16BE(this.error < 0 ? this.error + 65536 : this.error, 2);
    buf.writeUInt32BE(this.seq >>> 0, 4);
    keyBuf.copy(buf, 8);
    this.content.copy(buf, 8 + keyBuf.length);
    return buf;
  }

  static decode(bt: Buffer): WsMsg {
    if (bt.length < 8) throw new Error("ucast frame < 8");
    const n = bt[1]!;
    if (bt.length < 8 + n) throw new Error("ucast frame short");
    const m = new WsMsg();
    m.direction = bt[0]! & 1;
    const errU = bt.readUInt16BE(2);
    m.error = errU > 32767 ? errU - 65536 : errU;
    m.seq = bt.readUInt32BE(4);
    m.key = bt.subarray(8, 8 + n).toString("utf8");
    m.content = Buffer.from(bt.subarray(8 + n));
    return m;
  }
}

function contentText(buf: Buffer): string {
  return buf.toString("utf8");
}

function contentJson<T>(buf: Buffer): T {
  return JSON.parse(contentText(buf)) as T;
}

async function login(cfg: UcastConfig, signal: AbortSignal): Promise<string> {
  const nonce = genNonce();
  const proof = genProof(`${cfg.loginname}:${nonce}`);
  const body = new URLSearchParams({
    key: cfg.apiKey,
    password: cfg.password,
    web_version: "2",
    nonce,
    proof,
  });
  const url = `${cfg.baseUrl}/v3/users/login/${encodeURIComponent(cfg.loginname)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal,
  });
  const json = (await res.json()) as { error?: number; message?: string; user?: { token?: string } };
  if (json.error !== 0 || !json.user?.token) {
    throw new Error(`ucast login failed: ${json.message || `error=${json.error ?? "unknown"}`}`);
  }
  console.log("[ucast] login ok");
  return json.user.token;
}

function microToDeg(v: number): number {
  return v / 1_000_000;
}

export function startUcastPoller(onFix: (t: Telemetry) => void): void {
  onFixRef = onFix;
  // Direct starts are also replacements. This keeps callers other than the
  // admin restart path from accidentally stacking pollers.
  if (stopCurrent) stopCurrent();

  const cfg0 = loadConfig();
  if (!cfg0.enabled) {
    console.log("[ucast] disabled (set enabled:true in data/ucast.json or UCAST_ENABLED=1)");
    return;
  }
  if (isPlaceholder(cfg0.loginname) || isPlaceholder(cfg0.password) || !cfg0.devices.filter((d) => !isPlaceholder(d.sn)).length) {
    console.warn("[ucast] missing loginname/password/devices — skip");
    return;
  }

  const wsUrl = cfg0.baseUrl.replace(/^http/, "ws") + `/v3/ws/user/${encodeURIComponent(cfg0.loginname)}`;
  let seq = 1;
  let stopped = false;
  let loginAbort: AbortController | null = null;
  let stopSocket: (() => void) | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveRetry: (() => void) | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    loginAbort?.abort();
    loginAbort = null;
    stopSocket?.();
    stopSocket = null;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    resolveRetry?.();
    resolveRetry = null;
    if (stopCurrent === stop) stopCurrent = null;
  };

  stopCurrent = stop;

  const waitToReconnect = () =>
    new Promise<void>((resolve) => {
      if (stopped) return resolve();
      resolveRetry = resolve;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        resolveRetry = null;
        resolve();
      }, 4000);
    });

  const loop = async () => {
    while (!stopped) {
      try {
        loginAbort = new AbortController();
        const token = await login(loadConfig(), loginAbort.signal);
        loginAbort = null;
        if (stopped) break;
        await runSocket(token);
      } catch (err) {
        loginAbort = null;
        if (!stopped) console.warn("[ucast] session error", err);
      }
      if (stopped) break;
      await waitToReconnect();
    }
  };

  const runSocket = (token: string) =>
    new Promise<void>((resolve) => {
      const cfg = loadConfig();
      const ws = new WebSocket(wsUrl, {
        headers: {
          Authorization: `ACCESSTOKEN ${token}`,
          "Accept-Language": "zh-CN",
        },
      });
      let alive = true;
      let pollTimer: ReturnType<typeof setInterval> | null = null;

      const finish = () => {
        if (!alive) return;
        alive = false;
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        if (stopSocket === finish) stopSocket = null;
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
        resolve();
      };
      stopSocket = finish;

      const sendContinuous = () => {
        if (stopped || !alive || ws.readyState !== WebSocket.OPEN) return;
        for (const d of cfg.devices) {
          const m = new WsMsg();
          m.direction = 0;
          m.seq = seq++;
          m.key = "device/gps/continuous";
          m.content = Buffer.from(JSON.stringify({ sn: d.sn, seconds: 60 }), "utf8");
          ws.send(m.encode());
          console.log(`[ucast] request continuous sn=${d.sn} seq=${m.seq}`);
        }
      };

      ws.on("open", () => {
        if (stopped || !alive) return finish();
        console.log("[ucast] ws open");
        sendContinuous();
        pollTimer = setInterval(sendContinuous, 52_000);
      });

      ws.on("message", (data) => {
        if (stopped || !alive) return;
        try {
          const raw = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          const msg = WsMsg.decode(raw);
          if (msg.key === "device/gps/continuous") {
            const text = contentText(msg.content);
            if (msg.error) console.warn(`[ucast] continuous error=${msg.error} ${text}`);
            else console.log(`[ucast] continuous ack ${text}`);
            return;
          }
          if (msg.key === "device/gps/close") {
            console.warn("[ucast] device gps closed", contentText(msg.content));
            return;
          }
          if (msg.key !== "device/gps/tick") return;
          const body = contentJson<{ sn?: string; gps?: GpsTick }>(msg.content);
          const gps = body.gps;
          const sn = String(body.sn || "");
          if (!gps) return;
          if (typeof gps.error === "number" && gps.error !== 0) {
            console.log(`[ucast] tick no-fix sn=${sn} error=${gps.error}`);
            return;
          }
          const lat = microToDeg(Number(gps.latitude));
          const lng = microToDeg(Number(gps.longitude));
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          if (Math.abs(lat) + Math.abs(lng) < 1e-5) return;
          const mapped = cfg.devices.find((d) => d.sn === sn);
          const deviceId = (mapped?.device_id || sn).trim() || sn;
          const t: Telemetry = {
            device_id: deviceId,
            lat,
            lng,
            raw_lat: lat,
            raw_lng: lng,
            speed: Number(gps.speed) || 0,
            alt_baro: Number(gps.altitude) || 0,
            heading: Number(gps.direction) || 0,
            ts: Date.now(),
            bib: "",
            name: "",
            distance: 0,
            climb: 0,
            source: "gps",
          };
          if (!stopped && alive) onFix(t);
        } catch (err) {
          console.warn("[ucast] tick parse", err);
        }
      });

      ws.on("close", (code, reason) => {
        console.warn(`[ucast] ws close ${code} ${reason.toString()}`);
        finish();
      });
      ws.on("error", (err) => {
        console.warn("[ucast] ws error", err);
        finish();
      });
    });

  void loop();
  console.log(
    `[ucast] poller started devices=${cfg0.devices.map((d) => d.sn).join(",")}`
  );
}

function bootPoller(onFix: (t: Telemetry) => void) {
  startUcastPoller(onFix);
}
