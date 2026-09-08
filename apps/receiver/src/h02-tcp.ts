import net from "node:net";
import type { Telemetry } from "../../../packages/schema/src/telemetry.ts";
import { parseMt909Frame } from "./mt909-tcp.ts";

export type TelemetryHandler = (t: Telemetry) => void;

/** Traccar-style MESSAGE_SHORT / MESSAGE_LONG for H02 binary ($) frames. */
export const H02_MESSAGE_SHORT = 32;
export const H02_MESSAGE_LONG = 45;

/**
 * BCD helpers mirroring org.traccar.helper.BcdUtil.readInteger.
 * Odd digit counts peek the high nibble without advancing the offset.
 */
export function bcdReadInteger(
  buf: Buffer,
  offset: { i: number },
  digits: number
): number {
  let result = 0;
  for (let n = 0; n < Math.floor(digits / 2); n++) {
    const b = buf[offset.i++]!;
    result *= 10;
    result += b >>> 4;
    result *= 10;
    result += b & 0x0f;
  }
  if (digits % 2 !== 0) {
    const b = buf[offset.i]!;
    result *= 10;
    result += b >>> 4;
  }
  return result;
}

/**
 * H02 binary coordinate — mirrors H02ProtocolDecoder.readCoordinate.
 * Latitude: 2 BCD degree digits + 6 BCD minute fraction digits.
 * Longitude: 3 BCD degree digits (split across bytes) + 5 BCD minute digits.
 */
export function h02ReadCoordinate(buf: Buffer, offset: { i: number }, lon: boolean): number {
  let degrees = bcdReadInteger(buf, offset, 2);
  if (lon) {
    degrees = degrees * 10 + (buf[offset.i]! >>> 4);
  }

  let result = 0;
  if (lon) {
    result = buf[offset.i++]! & 0x0f;
  }

  const length = lon ? 5 : 6;
  result = result * 10 + bcdReadInteger(buf, offset, length) / 10000.0;
  result /= 60;
  result += degrees;
  return result;
}

export type H02BinaryPosition = {
  device_id: string;
  lat: number;
  lng: number;
  speedRaw: number;
  /** Speed in km/h (Traccar Position speed is knots; we convert * 1.852). */
  speedKmh: number;
  course: number;
  valid: boolean;
  ts: number;
  status: number;
  batteryRaw: number;
  frameLen: number;
};

function hexDump(buf: Buffer, start: number, len: number): string {
  return buf.subarray(start, start + len).toString("hex");
}

/**
 * Decode one H02 binary frame starting at buf[0] === 0x24.
 * Frame length === 42 → long id (8 bytes, first 15 hex chars); else short id (5 bytes).
 * Real MT909/H02 devices use short id (e.g. 7026238813), not IMEI.
 */
export function decodeH02Binary(frame: Buffer): H02BinaryPosition | null {
  if (frame.length < 29 || frame[0] !== 0x24) return null;

  const longId = frame.length === 42;
  const offset = { i: 1 }; // skip marker

  let device_id: string;
  if (longId) {
    if (frame.length < 1 + 8) return null;
    device_id = hexDump(frame, offset.i, 8).substring(0, 15);
    offset.i += 8;
  } else {
    if (frame.length < 1 + 5) return null;
    device_id = hexDump(frame, offset.i, 5);
    offset.i += 5;
  }

  if (frame.length - offset.i < 22) return null;

  const hour = bcdReadInteger(frame, offset, 2);
  const minute = bcdReadInteger(frame, offset, 2);
  const second = bcdReadInteger(frame, offset, 2);
  const day = bcdReadInteger(frame, offset, 2);
  const month = bcdReadInteger(frame, offset, 2);
  const year = bcdReadInteger(frame, offset, 2);

  let lat = h02ReadCoordinate(frame, offset, false);
  const batteryRaw = frame[offset.i++]!;
  let lng = h02ReadCoordinate(frame, offset, true);

  const flags = frame[offset.i++]! & 0x0f;
  const valid = (flags & 0x02) !== 0;
  if ((flags & 0x04) === 0) lat = -lat;
  if ((flags & 0x08) === 0) lng = -lng;

  const speedRaw = bcdReadInteger(frame, offset, 3);
  const course =
    (frame[offset.i++]! & 0x0f) * 100.0 + bcdReadInteger(frame, offset, 2);

  if (offset.i + 4 > frame.length) return null;
  const status =
    ((frame[offset.i]! << 24) |
      (frame[offset.i + 1]! << 16) |
      (frame[offset.i + 2]! << 8) |
      frame[offset.i + 3]!) >>>
    0;
  offset.i += 4;

  if (
    year > 99 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  const ts = Date.UTC(2000 + year, month - 1, day, hour, minute, second);
  const speedKmh = Math.round(speedRaw * 1.852 * 10) / 10;

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }

  return {
    device_id,
    lat,
    lng,
    speedRaw,
    speedKmh,
    course,
    valid,
    ts,
    status,
    batteryRaw,
    frameLen: frame.length,
  };
}

export function h02PositionToTelemetry(pos: H02BinaryPosition): Telemetry | null {
  if (!pos.valid) return null;
  if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return null;
  // Drop misframed ghosts (e.g. doubled `$` → lng ≈ -641).
  if (pos.lat < -90 || pos.lat > 90 || pos.lng < -180 || pos.lng > 180) return null;

  const name = pos.device_id.length > 6 ? pos.device_id.slice(-6) : pos.device_id;
  const t: Telemetry = {
    device_id: pos.device_id,
    lat: pos.lat,
    lng: pos.lng,
    speed: pos.speedKmh,
    alt_baro: 0,
    climb: 0,
    ts: pos.ts,
    bib: "",
    name,
    distance: 0,
  };
  if (Number.isFinite(pos.course)) t.heading = pos.course;
  return t;
}

function formatHHmmssUtc(d = new Date()): string {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}${mm}${ss}`;
}

/** Optional ACK mirroring Traccar sendResponse R12. */
export function buildH02Ack(deviceId: string, now = new Date()): string {
  return `*HQ,${deviceId},R12,${formatHHmmssUtc(now)}#`;
}

/**
 * Parse H02 ASCII text frame `*HQ,<id>,V1,<HHMMSS>,A/V,<lat>,N/S,<lon>,E/W,<spd>,<course>,<DDMMYY>,...#`
 * (subset of Traccar H02 text). Returns null if not a position sentence.
 */
export function parseH02AsciiText(sentence: string): Telemetry | null {
  const text = sentence.replace(/\r/g, "").trim();
  if (!text.startsWith("*") || !text.includes("#")) return null;

  const body = text.endsWith("#") ? text.slice(0, -1) : text;
  const parts = body.split(",");
  // *HQ, id, type, ...
  if (parts.length < 4) return null;
  const id = (parts[1] ?? "").trim();
  const type = (parts[2] ?? "").trim().toUpperCase();
  if (!id) return null;

  // Heartbeat / non-position: ignore for telemetry (ACK handled by caller if needed)
  if (type === "HTBT" || type === "V0" || type === "NBR" || type === "LINK" || type === "SMS") {
    return null;
  }

  // V1 / generic: *HQ,id,V1,HHMMSS,A,ddmm.mmmm,N,dddmm.mmmm,E,speed,course,DDMMYY,...
  const timeIdx = type.match(/^V\d/i) || type === "V1" ? 3 : 3;
  const utc = parts[timeIdx] ?? "";
  const validFlag = (parts[timeIdx + 1] ?? "").toUpperCase();
  if (validFlag === "V") return null;

  const latRaw = Number(parts[timeIdx + 2]);
  const latHemi = (parts[timeIdx + 3] ?? "N").toUpperCase();
  const lngRaw = Number(parts[timeIdx + 4]);
  const lngHemi = (parts[timeIdx + 5] ?? "E").toUpperCase();
  const speedKn = Number(parts[timeIdx + 6]) || 0;
  const course = Number(parts[timeIdx + 7]);
  const date = parts[timeIdx + 8] ?? "";

  if (!Number.isFinite(latRaw) || !Number.isFinite(lngRaw)) return null;
  if (!/^\d{6}/.test(utc) || date.length < 6) return null;
  if (validFlag && validFlag !== "A" && validFlag !== "B") {
    // some devices omit A/V; if next looks numeric latitude, still try — already parsed
  }

  const latAbs = Math.abs(latRaw);
  const lat = (Math.floor(latAbs / 100) + (latAbs % 100) / 60) * (latHemi === "S" ? -1 : 1);
  const lngAbs = Math.abs(lngRaw);
  const lng = (Math.floor(lngAbs / 100) + (lngAbs % 100) / 60) * (lngHemi === "W" ? -1 : 1);

  const hh = Number(utc.slice(0, 2));
  const mm = Number(utc.slice(2, 4));
  const ss = Number(utc.slice(4, 6));
  const dd = Number(date.slice(0, 2));
  const mo = Number(date.slice(2, 4));
  let yy = Number(date.slice(4, 6));
  yy = yy >= 70 ? 1900 + yy : 2000 + yy;
  const ts = Date.UTC(yy, mo - 1, dd, hh, mm, ss);

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const t: Telemetry = {
    device_id: id,
    lat,
    lng,
    speed: Math.round(speedKn * 1.852 * 10) / 10,
    alt_baro: 0,
    climb: 0,
    ts,
    bib: "",
    name: id.length > 6 ? id.slice(-6) : id,
    distance: 0,
  };
  if (Number.isFinite(course)) t.heading = course;
  return t;
}

/** Resolve binary frame length (Traccar H02FrameDecoder: 32 short / 45 long). */
export function detectH02FrameLength(buf: Buffer, locked: number): number | null {
  if (locked > 0) return buf.length >= locked ? locked : null;
  if (buf.length < H02_MESSAGE_SHORT) return null;
  if (buf.length === H02_MESSAGE_LONG) return H02_MESSAGE_LONG;
  // Concatenated short frames
  if (buf.length > H02_MESSAGE_SHORT && buf[H02_MESSAGE_SHORT] === 0x24) {
    return H02_MESSAGE_SHORT;
  }
  if (buf.length >= H02_MESSAGE_LONG && buf[H02_MESSAGE_LONG] === 0x24) {
    return H02_MESSAGE_LONG;
  }
  // Prefer short (5-byte id) for real devices like 7026238813
  if (buf.length >= H02_MESSAGE_SHORT) return H02_MESSAGE_SHORT;
  return null;
}

/**
 * H02 TCP listener: `$` binary (production) + `*` ASCII H02 text + legacy Mictrack `#…##` fallback.
 * Default port 5013 (H02_TCP_PORT / MT909_TCP_PORT).
 */
export function startH02TcpServer(
  onTelemetry: TelemetryHandler,
  port = Number(process.env.H02_TCP_PORT) ||
    Number(process.env.MT909_TCP_PORT) ||
    5013,
  opts: { sendAck?: boolean } = {}
) {
  const sendAck = opts.sendAck !== false;

  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    let lockedFrameLen = 0;
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[h02] connect ${remote}`);

    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);

      while (buf.length > 0) {
        // Skip noise until marker *, $, or Mictrack #
        const star = buf.indexOf(0x2a); // *
        const dollar = buf.indexOf(0x24); // $
        const hash = buf.indexOf(0x23); // #

        let start = -1;
        let kind: "star" | "dollar" | "hash" | null = null;
        const candidates: { i: number; k: typeof kind }[] = [];
        if (star >= 0) candidates.push({ i: star, k: "star" });
        if (dollar >= 0) candidates.push({ i: dollar, k: "dollar" });
        if (hash >= 0) candidates.push({ i: hash, k: "hash" });
        if (candidates.length === 0) {
          buf = Buffer.alloc(0);
          break;
        }
        candidates.sort((a, b) => a.i - b.i);
        start = candidates[0]!.i;
        kind = candidates[0]!.k;
        if (start > 0) buf = buf.subarray(start);

        if (kind === "dollar") {
          // Collapse doubled `$` (0x24 0x24…) so ID bytes stay aligned.
          // Mis-sync otherwise invents ids like 2470262388 (bib "2388").
          while (buf.length >= 2 && buf[0] === 0x24 && buf[1] === 0x24) {
            console.warn("[h02] skip doubled $ marker");
            buf = buf.subarray(1);
          }
          if (buf.length === 0 || buf[0] !== 0x24) continue;

          const frameLen = detectH02FrameLength(buf, lockedFrameLen);
          if (frameLen == null) break;
          if (lockedFrameLen === 0) lockedFrameLen = frameLen;
          if (buf.length < frameLen) break;

          const frame = Buffer.from(buf.subarray(0, frameLen));
          buf = buf.subarray(frameLen);

          const rawHex = frame.subarray(0, Math.min(32, frame.length)).toString("hex");
          try {
            const pos = decodeH02Binary(frame);
            if (!pos) {
              console.warn(
                `[h02] binary decode fail len=${frameLen} rawHex=${rawHex}`
              );
              continue;
            }
            console.log(
              `[h02] $ binary id=${pos.device_id} lat=${pos.lat.toFixed(5)} lng=${pos.lng.toFixed(5)} ` +
                `course=${pos.course} speedRaw=${pos.speedRaw} kmh=${pos.speedKmh} valid=${pos.valid} ` +
                `ts=${new Date(pos.ts).toISOString()} rawHex=${rawHex}`
            );
            const t = h02PositionToTelemetry(pos);
            if (t) onTelemetry(t);
            if (sendAck) socket.write(buildH02Ack(pos.device_id));
          } catch (err) {
            console.warn(`[h02] binary parse error rawHex=${rawHex}`, err);
          }
          continue;
        }

        if (kind === "star") {
          const end = buf.indexOf(0x23); // #
          if (end < 0) break;
          const sentence = buf.subarray(0, end + 1).toString("ascii");
          buf = buf.subarray(end + 1);
          // skip trailing CR/LF
          while (buf.length && (buf[0] === 0x0d || buf[0] === 0x0a)) {
            buf = buf.subarray(1);
          }

          try {
            // Echo heartbeat responses like Traccar for V0/HTBT
            const m = sentence.match(/^\*[^,]+,([^,]+),(V0|HTBT)\b/i);
            if (m) {
              const id = m[1]!;
              if (sendAck) socket.write(sentence); // echo
              console.log(`[h02] * heartbeat id=${id}`);
              continue;
            }
            const t = parseH02AsciiText(sentence);
            if (t) {
              console.log(
                `[h02] * ascii id=${t.device_id} lat=${t.lat.toFixed(5)} lng=${t.lng.toFixed(5)}`
              );
              onTelemetry(t);
              if (sendAck) socket.write(buildH02Ack(t.device_id));
            } else {
              // Still ACK R12 for unknown * frames with an id
              const idMatch = sentence.match(/^\*[^,]+,([^,]+),/);
              if (idMatch && sendAck) socket.write(buildH02Ack(idMatch[1]!));
            }
          } catch (err) {
            console.warn("[h02] ascii parse error", err);
          }
          continue;
        }

        // Legacy Mictrack `#IMEI#...##` — not production default; keep as fallback
        if (kind === "hash") {
          const text = buf.toString("utf8");
          const idx = text.indexOf("##");
          if (idx < 0) {
            // Might actually be noise before a $ / * — if $ appears later wait; if only # wait for ##
            if (buf.length > 64_000) buf = buf.subarray(-8_000);
            break;
          }
          const frame = text.slice(0, idx);
          const consumed = Buffer.byteLength(text.slice(0, idx + 2), "utf8");
          buf = buf.subarray(consumed);
          while (buf.length && (buf[0] === 0x0d || buf[0] === 0x0a)) {
            buf = buf.subarray(1);
          }
          try {
            const t = parseMt909Frame(frame);
            if (t) {
              console.log(
                `[h02] mictrack-fallback id=${t.device_id} lat=${t.lat.toFixed(5)} lng=${t.lng.toFixed(5)}`
              );
              onTelemetry(t);
            }
          } catch (err) {
            console.warn("[h02] mictrack fallback error", err);
          }
          continue;
        }

        break;
      }

      if (buf.length > 64_000) buf = buf.subarray(-8_000);
    });

    socket.on("error", (err) => {
      console.warn(`[h02] socket error ${remote}`, err.message);
    });
    socket.on("close", () => {
      console.log(`[h02] close ${remote}`);
    });
  });

  server.listen(port, () => {
    console.log(
      `[h02] TCP listening on 0.0.0.0:${port} ($ binary + * ASCII; Mictrack # fallback)`
    );
  });
  server.on("error", (err) => {
    console.error("[h02] server error", err);
  });

  return server;
}
