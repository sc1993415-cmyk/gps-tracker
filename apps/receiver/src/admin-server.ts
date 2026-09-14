import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getRoster,
  saveRoster,
  upsertRoster,
  deleteRosterEntry,
  rosterToCsv,
  importRosterCsv,
} from "./roster.ts";
import {
  listPendingDiscovered,
  dismissDiscovered,
  clearDiscoveredOnRoster,
} from "./discovery.ts";
import {
  buildMt909Command,
  sendRawCommand,
  listOnlineDevices,
  isDeviceOnline,
  listCommandReceipts,
  type Mt909CmdKind,
} from "./device-sessions.ts";
import {
  getMapStyle,
  saveMapStyle,
  listMapStyles,
} from "./map-style.ts";
import {
  getListColumns,
  saveListColumns,
  LIST_COLUMN_LABELS,
} from "./list-columns.ts";
import { getHudFieldsConfig, setHudFields } from "./hud-fields.ts";
import { getCourseEndsConfig, setCourseEndsEnabled } from "./course-ends.ts";
import { uploadGpx, clearPersistedCourse } from "./gpx.ts";
import {
  getSession,
  setEventName,
  startSession,
  endSession,
  resetSession,
} from "./session.ts";
import { getSnapConfig, setSnapEnabled } from "./snap.ts";
import { getCoastConfig, setCoastEnabled } from "./course-coast.ts";
import { getTrailBreakConfig, setTrailBreakM } from "./trail-break.ts";
import { getInterpDelayConfig, setInterpDelayEnabled } from "./interp-delay.ts";
import { lookupCell, getCellDbStats, ensureCellDbLoaded } from "./cell-lookup.ts";
import { getCellocationStats } from "./cellocation.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_HTML = path.resolve(__dirname, "../public/admin.html");

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage, limit = 5_000_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on("data", (c) => {
      const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
      n += b.length;
      if (n > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(b);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Extract file payload from multipart/form-data (first file part). */
function extractMultipartFile(buf: Buffer, contentType: string): string | null {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) return null;
  const boundary = (m[1] || m[2] || "").trim();
  if (!boundary) return null;
  const parts = buf.toString("utf8").split("--" + boundary);
  for (const part of parts) {
    if (!/Content-Disposition:/i.test(part)) continue;
    if (!/filename=/i.test(part) && !/name="(?:file|gpx|course)"/i.test(part)) continue;
    const idx = part.indexOf("\r\n\r\n");
    const idx2 = idx < 0 ? part.indexOf("\n\n") : idx;
    if (idx2 < 0) continue;
    let body = part.slice(idx2 + (idx >= 0 ? 4 : 2));
    // strip trailing CRLF / closing dashes
    body = body.replace(/\r\n--\s*$/, "").replace(/\r\n$/, "").replace(/\n$/, "");
    if (body.trim()) return body;
  }
  return null;
}

function serveAdminPage(res: http.ServerResponse) {
  try {
    const html = fs.readFileSync(ADMIN_HTML, "utf8");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(html);
  } catch (err) {
    sendJson(res, 500, { error: `admin.html missing: ${String(err)}` });
  }
}

/**
 * Tiny roster admin HTTP server (plain HTML + JSON API).
 * Default port 8790 — does not share the WS port.
 */
export function startAdminServer(port = Number(process.env.ADMIN_PORT) || 8790) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const method = (req.method || "GET").toUpperCase();

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    try {
      if (
        (url.pathname === "/" || url.pathname === "/admin" || url.pathname === "/admin.html") &&
        method === "GET"
      ) {
        serveAdminPage(res);
        return;
      }

      if (url.pathname === "/api/roster" && method === "GET") {
        sendJson(res, 200, getRoster());
        return;
      }

      if (url.pathname === "/api/roster" && (method === "PUT" || method === "POST")) {
        const raw = (await readBody(req)).toString("utf8");
        const parsed = raw ? JSON.parse(raw) : [];
        if (method === "PUT") {
          if (!Array.isArray(parsed)) {
            sendJson(res, 400, { error: "PUT body must be a JSON array" });
            return;
          }
          sendJson(res, 200, saveRoster(parsed));
          return;
        }
        // POST: upsert one object or an array of objects
        const list = Array.isArray(parsed) ? parsed : [parsed];
        sendJson(res, 200, upsertRoster(list));
        return;
      }

      const delMatch = url.pathname.match(/^\/api\/roster\/([^/]+)$/);
      if (delMatch && method === "DELETE") {
        const deviceId = decodeURIComponent(delMatch[1]!);
        sendJson(res, 200, deleteRosterEntry(deviceId));
        return;
      }

      if (url.pathname === "/api/roster.csv" && method === "GET") {
        const csv = rosterToCsv();
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="roster.csv"',
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(csv);
        return;
      }

      if (url.pathname === "/api/roster/import" && method === "POST") {
        const raw = (await readBody(req)).toString("utf8");
        let text = raw;
        let mode: "replace" | "merge" = "merge";
        const ct = String(req.headers["content-type"] || "");
        if (ct.includes("application/json")) {
          const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
          text = String(body.csv ?? body.text ?? "");
          mode = body.mode === "replace" ? "replace" : "merge";
        } else {
          mode = url.searchParams.get("mode") === "replace" ? "replace" : "merge";
        }
        if (!text.trim()) {
          sendJson(res, 400, { error: "empty CSV" });
          return;
        }
        const list = importRosterCsv(text, mode);
        for (const e of list) clearDiscoveredOnRoster(e.device_id);
        sendJson(res, 200, list);
        return;
      }

      if (url.pathname === "/api/discovered" && method === "GET") {
        sendJson(res, 200, listPendingDiscovered());
        return;
      }

      const acceptMatch = url.pathname.match(/^\/api\/discovered\/([^/]+)\/accept$/);
      if (acceptMatch && method === "POST") {
        const deviceId = decodeURIComponent(acceptMatch[1]!);
        const raw = (await readBody(req)).toString("utf8");
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const entry = {
          device_id: deviceId,
          imei: body.imei ? String(body.imei) : undefined,
          bib: body.bib != null ? String(body.bib) : "",
          name: body.name != null ? String(body.name) : deviceId,
          color: body.color != null ? String(body.color) : "#ff9800",
        };
        const list = upsertRoster([entry]);
        clearDiscoveredOnRoster(deviceId);
        sendJson(res, 200, { roster: list, added: entry });
        return;
      }

      const dismissMatch = url.pathname.match(/^\/api\/discovered\/([^/]+)$/);
      if (dismissMatch && method === "DELETE") {
        const deviceId = decodeURIComponent(dismissMatch[1]!);
        sendJson(res, 200, dismissDiscovered(deviceId));
        return;
      }

      if (url.pathname === "/api/map-style" && method === "GET") {
        sendJson(res, 200, { current: getMapStyle(), options: listMapStyles() });
        return;
      }

      if (url.pathname === "/api/map-style" && (method === "PUT" || method === "POST")) {
        const raw = (await readBody(req)).toString("utf8");
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const id = body.id ?? body.style ?? body.mapStyle;
        sendJson(res, 200, saveMapStyle(id));
        return;
      }

      if (url.pathname === "/api/course-ends" && method === "GET") {
        sendJson(res, 200, getCourseEndsConfig());
        return;
      }

      if (url.pathname === "/api/course-ends" && (method === "PUT" || method === "POST")) {
        const raw = (await readBody(req)).toString("utf8");
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const en = body.enabled;
        sendJson(res, 200, setCourseEndsEnabled(en === true || en === "true" || en === 1));
        return;
      }

      if (url.pathname === "/api/hud-fields" && method === "GET") {
        sendJson(res, 200, getHudFieldsConfig());
        return;
      }

      if (url.pathname === "/api/hud-fields" && (method === "PUT" || method === "POST")) {
        const raw = (await readBody(req)).toString("utf8");
        const body = raw ? JSON.parse(raw) : {};
        sendJson(res, 200, setHudFields(body));
        return;
      }

      if (url.pathname === "/api/list-columns" && method === "GET") {
        sendJson(res, 200, {
          columns: getListColumns(),
          labels: LIST_COLUMN_LABELS,
        });
        return;
      }

      if (url.pathname === "/api/list-columns" && (method === "PUT" || method === "POST")) {
        const raw = (await readBody(req)).toString("utf8");
        const body = raw ? JSON.parse(raw) : {};
        const payload = body.columns ?? body.listColumns ?? body;
        sendJson(res, 200, { columns: saveListColumns(payload) });
        return;
      }

      if (url.pathname === "/api/course" && (method === "DELETE" || method === "POST") && url.searchParams.get("clear") === "1") {
        const { removed } = clearPersistedCourse();
        sendJson(res, 200, { ok: true, cleared: true, removed });
        return;
      }
      if (url.pathname === "/api/course/clear" && (method === "POST" || method === "DELETE")) {
        const { removed } = clearPersistedCourse();
        sendJson(res, 200, { ok: true, cleared: true, removed });
        return;
      }

      if (url.pathname === "/api/course/gpx" && method === "POST") {
        const ct = String(req.headers["content-type"] || "");
        const buf = await readBody(req, 8_000_000);
        let xml = "";
        if (/multipart\/form-data/i.test(ct)) {
          xml = extractMultipartFile(buf, ct) || "";
        } else if (/application\/json/i.test(ct)) {
          const body = JSON.parse(buf.toString("utf8") || "{}") as Record<string, unknown>;
          xml = String(body.gpx ?? body.xml ?? body.content ?? "");
        } else {
          // raw text / application/gpx+xml / text/xml
          xml = buf.toString("utf8");
        }
        xml = xml.trim();
        if (!xml || !/<gpx[\s>]/i.test(xml)) {
          sendJson(res, 400, { error: "GPX XML required (multipart file, JSON {gpx}, or raw body)" });
          return;
        }
        const nameMatch = xml.match(/<name>([^<]+)<\/name>/i);
        const result = uploadGpx(xml, nameMatch?.[1]?.trim());
        sendJson(res, 200, {
          ok: true,
          pointCount: result.pointCount,
          totalM: Math.round(result.totalM * 10) / 10,
          source: result.source,
          paths: result.paths,
          properties: result.feature.properties,
        });
        return;
      }

      if (url.pathname === "/api/snap" && method === "GET") {
        sendJson(res, 200, getSnapConfig());
        return;
      }

      if (url.pathname === "/api/snap" && (method === "PUT" || method === "POST")) {
        const raw = (await readBody(req)).toString("utf8");
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const en = body.enabled;
        sendJson(res, 200, setSnapEnabled(en === true || en === "true" || en === 1));
        return;
      }

      if (url.pathname === "/api/coast" && method === "GET") {
        sendJson(res, 200, getCoastConfig());
        return;
      }

      if (url.pathname === "/api/coast" && (method === "PUT" || method === "POST")) {
        const raw = (await readBody(req)).toString("utf8");
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const en = body.enabled;
        sendJson(res, 200, setCoastEnabled(en === true || en === "true" || en === 1));
        return;
      }

      if (url.pathname === "/api/trail-break" && method === "GET") {
        sendJson(res, 200, getTrailBreakConfig());
        return;
      }

      if (url.pathname === "/api/trail-break" && (method === "PUT" || method === "POST")) {
        const raw = (await readBody(req)).toString("utf8");
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const n = Number(body.breakM ?? body.m ?? body.value);
        sendJson(res, 200, setTrailBreakM(n));
        return;
      }

      if (url.pathname === "/api/interp-delay" && method === "GET") {
        sendJson(res, 200, getInterpDelayConfig());
        return;
      }

      if (url.pathname === "/api/interp-delay" && (method === "PUT" || method === "POST")) {
        const raw = (await readBody(req)).toString("utf8");
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const en = body.enabled;
        sendJson(res, 200, setInterpDelayEnabled(en === true || en === "true" || en === 1));
        return;
      }

      if (url.pathname === "/api/session" && method === "GET") {
        sendJson(res, 200, getSession());
        return;
      }

      if (url.pathname === "/api/session/event-name" && (method === "PUT" || method === "POST")) {
        const raw = (await readBody(req)).toString("utf8");
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const name = body.name ?? body.event_name ?? body.eventName;
        sendJson(res, 200, setEventName(String(name ?? "")));
        return;
      }

      if (url.pathname === "/api/session/start" && method === "POST") {
        sendJson(res, 200, startSession());
        return;
      }

      if (url.pathname === "/api/session/end" && method === "POST") {
        sendJson(res, 200, endSession());
        return;
      }

      if (url.pathname === "/api/session/reset" && method === "POST") {
        sendJson(res, 200, resetSession());
        return;
      }

      if (url.pathname === "/api/cellocation" && method === "GET") {
        sendJson(res, 200, getCellocationStats());
        return;
      }

      if (url.pathname === "/api/cell/lookup" && method === "GET") {
        ensureCellDbLoaded();
        const mcc = Number(url.searchParams.get("mcc") ?? 460);
        const mnc = Number(url.searchParams.get("mnc") ?? 0);
        const lac = Number(url.searchParams.get("lac"));
        const ciRaw = url.searchParams.get("ci");
        const ci = ciRaw != null && ciRaw !== "" ? Number(ciRaw) : undefined;
        if (!Number.isFinite(lac)) {
          sendJson(res, 400, { error: "lac required", db: getCellDbStats() });
          return;
        }
        sendJson(res, 200, {
          query: { mcc, mnc, lac, ci },
          hit: lookupCell(mcc, mnc, lac, ci),
          db: getCellDbStats(),
        });
        return;
      }

      if (url.pathname === "/api/devices/online" && method === "GET") {
        sendJson(res, 200, { online: listOnlineDevices() });
        return;
      }

      if (url.pathname === "/api/command/receipts" && method === "GET") {
        sendJson(res, 200, { receipts: listCommandReceipts() });
        return;
      }

      if (url.pathname === "/api/command" && method === "POST") {
        const raw = (await readBody(req)).toString("utf8");
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const deviceId = String(body.device_id ?? "").trim();
        const cmd = String(body.cmd ?? "").trim().toLowerCase() as Mt909CmdKind;
        if (!deviceId) {
          sendJson(res, 400, { error: "device_id required" });
          return;
        }
        const rawCmd = String(body.raw ?? body.command ?? "").trim();
        if (rawCmd) {
          const sent = sendRawCommand(deviceId, rawCmd);
          if (!sent.ok) {
            sendJson(res, 400, { error: sent.error });
            return;
          }
          sendJson(res, 200, {
            ok: true,
            device_id: deviceId,
            cmd: "raw",
            command: rawCmd,
            online: isDeviceOnline(deviceId),
            queued: sent.queued,
            receipt: sent.receipt,
          });
          return;
        }
        if (cmd !== "freq" && cmd !== "ip" && cmd !== "cq") {
          sendJson(res, 400, { error: "cmd must be freq | ip | cq, or pass raw" });
          return;
        }
        let commandText: string;
        try {
          commandText = buildMt909Command(cmd, {
            password: body.password != null ? String(body.password) : undefined,
            intervalSec:
              body.interval != null
                ? Number(body.interval)
                : body.intervalSec != null
                  ? Number(body.intervalSec)
                  : undefined,
            host: body.host != null ? String(body.host) : body.ip != null ? String(body.ip) : undefined,
            port: body.port != null ? Number(body.port) : undefined,
          });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
          return;
        }
        const result = sendRawCommand(deviceId, commandText);
        if (!result.ok) {
          sendJson(res, 400, { error: result.error, command: commandText });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          device_id: deviceId,
          cmd,
          command: commandText,
          online: isDeviceOnline(deviceId),
          queued: result.queued,
          receipt: result.receipt,
        });
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      console.warn("[admin]", err);
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.listen(port, () => {
    console.log(
      `[admin] UI http://localhost:${port}/  (API /api/session /api/roster /api/discovered /api/command /api/command/receipts /api/map-style /api/list-columns /api/course/gpx /api/snap /api/coast)`
    );
  });
  server.on("error", (err) => {
    console.error("[admin] server error", err);
  });

  return server;
}
