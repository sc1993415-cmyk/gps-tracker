import net from "node:net";
import type { Telemetry } from "../../../packages/schema/src/telemetry.ts";

/** NMEA ddmm.mmmm (+ hemisphere) → decimal degrees */
export function nmeaToDecimal(raw: number, hemi: string): number {
  const abs = Math.abs(raw);
  const deg = Math.floor(abs / 100) + (abs % 100) / 60;
  const signed = hemi === "S" || hemi === "W" ? -deg : deg;
  return signed;
}

/** GPRMC hhmmss(.ss) + ddmmyy → Unix ms (UTC); 2-digit year → 2000–2099 */
export function gprmcToUnixMs(utc: string, date: string): number {
  const uh = utc.split(".")[0] ?? utc;
  const hh = Number(uh.slice(0, 2));
  const mm = Number(uh.slice(2, 4));
  const ss = Number(uh.slice(4, 6));
  const frac = utc.includes(".") ? Number(`0.${utc.split(".")[1]}`) : 0;

  const dd = Number(date.slice(0, 2));
  const mo = Number(date.slice(2, 4));
  let yy = Number(date.slice(4, 6));
  yy = yy >= 70 ? 1900 + yy : 2000 + yy;

  const ms = Math.round(frac * 1000);
  return Date.UTC(yy, mo - 1, dd, hh, mm, ss, ms);
}

/**
 * Parse one Mictrack open-protocol frame (content before trailing ##).
 * Returns null if invalid / void (V) fix.
 */
export function parseMt909Frame(frame: string): Telemetry | null {
  const text = frame.replace(/\r/g, "").trim();
  if (!text) return null;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const header = lines[0]!;
  // #<IMEI>#<user>#<pwd>#<Status>#<qty>
  const headerParts = header.split("#").filter(Boolean);
  const imei = headerParts[0];
  if (!imei) return null;

  const gprmcLine = lines.find((l) => l.includes("$GPRMC,")) ?? lines[1]!;
  const dollar = gprmcLine.indexOf("$GPRMC,");
  if (dollar < 0) return null;
  const nmea = gprmcLine.slice(dollar);
  // $GPRMC,utc,status,lat,N/S,lng,E/W,speed,course,date,...
  const body = nmea.startsWith("$") ? nmea.slice(1) : nmea;
  const star = body.indexOf("*");
  const fields = (star >= 0 ? body.slice(0, star) : body).split(",");
  // fields[0]=GPRMC
  const utc = fields[1] ?? "";
  const status = fields[2] ?? "";
  if (status === "V") return null;
  if (status !== "A") return null;

  const latRaw = Number(fields[3]);
  const latHemi = fields[4] ?? "N";
  const lngRaw = Number(fields[5]);
  const lngHemi = fields[6] ?? "E";
  if (!Number.isFinite(latRaw) || !Number.isFinite(lngRaw)) return null;

  const speedKn = Number(fields[7]) || 0;
  const course = Number(fields[8]);
  const date = fields[9] ?? "";
  if (!utc || date.length < 6) return null;

  const lat = nmeaToDecimal(latRaw, latHemi);
  const lng = nmeaToDecimal(lngRaw, lngHemi);
  const speed = Math.round(speedKn * 1.852 * 10) / 10;
  const ts = gprmcToUnixMs(utc, date);
  const name = imei.length > 6 ? imei.slice(-6) : imei;

  const t: Telemetry = {
    device_id: imei,
    lat,
    lng,
    speed,
    alt_baro: 0,
    climb: 0,
    ts,
    bib: "",
    name,
    distance: 0,
  };
  if (Number.isFinite(course)) t.heading = course;
  return t;
}

export type TelemetryHandler = (t: Telemetry) => void;

/**
 * Mictrack MT909 / open-protocol TCP listener.
 * Frames end with `##`; partial TCP chunks are buffered.
 */
export function startMt909TcpServer(
  onTelemetry: TelemetryHandler,
  port = Number(process.env.MT909_TCP_PORT) || 5013
) {
  const server = net.createServer((socket) => {
    let buf = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buf += chunk;
      // Frames may arrive concatenated; split on ##
      let idx: number;
      while ((idx = buf.indexOf("##")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        // Drop leading newlines between frames
        buf = buf.replace(/^\r?\n*/, "");
        try {
          const t = parseMt909Frame(frame);
          if (t) onTelemetry(t);
        } catch (err) {
          console.warn("[mt909] parse error", err);
        }
      }
      // Cap buffer to avoid unbounded growth on garbage
      if (buf.length > 64_000) buf = buf.slice(-8_000);
    });
    socket.on("error", (err) => {
      console.warn("[mt909] socket error", err.message);
    });
  });

  server.listen(port, () => {
    console.log(`[mt909] TCP listening on 0.0.0.0:${port}`);
  });
  server.on("error", (err) => {
    console.error("[mt909] server error", err);
  });

  return server;
}
