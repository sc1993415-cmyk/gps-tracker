import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getRoster,
  saveRoster,
  upsertRoster,
  deleteRosterEntry,
} from "./roster.ts";
import {
  buildMt909Command,
  sendRawCommand,
  listOnlineDevices,
  isDeviceOnline,
  type Mt909CmdKind,
} from "./device-sessions.ts";
import {
  getMapStyle,
  saveMapStyle,
  listMapStyles,
} from "./map-style.ts";

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

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      if (chunks.reduce((n, b) => n + b.length, 0) > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
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
        const raw = await readBody(req);
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


      if (url.pathname === "/api/map-style" && method === "GET") {
        sendJson(res, 200, { current: getMapStyle(), options: listMapStyles() });
        return;
      }

      if (url.pathname === "/api/map-style" && (method === "PUT" || method === "POST")) {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const id = body.id ?? body.style ?? body.mapStyle;
        sendJson(res, 200, saveMapStyle(id));
        return;
      }

      if (url.pathname === "/api/devices/online" && method === "GET") {
        sendJson(res, 200, { online: listOnlineDevices() });
        return;
      }

      if (url.pathname === "/api/command" && method === "POST") {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const deviceId = String(body.device_id ?? "").trim();
        const cmd = String(body.cmd ?? "").trim().toLowerCase() as Mt909CmdKind;
        if (!deviceId) {
          sendJson(res, 400, { error: "device_id required" });
          return;
        }
        if (cmd !== "freq" && cmd !== "ip" && cmd !== "cq") {
          sendJson(res, 400, { error: "cmd must be freq | ip | cq" });
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
    console.log(`[admin] roster UI http://localhost:${port}/  (API /api/roster /api/command /api/map-style)`);
  });
  server.on("error", (err) => {
    console.error("[admin] server error", err);
  });

  return server;
}
