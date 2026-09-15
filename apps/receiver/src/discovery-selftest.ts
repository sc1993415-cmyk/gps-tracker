/**
 * Discovery + device-id plausibility selftest.
 *
 * Guards the contract that a bare Ucast SN is a legitimate device id (it used to
 * be swallowed as `drop ghost`), while the H02 heuristics stay strict.
 *
 * Run: pnpm --filter receiver test:discovery
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-selftest-"));
process.env.DISCOVERY_PATH = path.join(tmp, "discovered.json");
process.env.ROSTER_PATH = path.join(tmp, "roster.json");
process.env.GPS_DISCOVERY_MIN_HITS = "3";

const {
  isPlausibleDeviceId,
  isPlausibleUcastDeviceId,
  isPlausibleCoord,
  noteUnknownSighting,
  listPendingDiscovered,
  dismissDiscovered,
  DISCOVERY_PATH,
} = await import("./discovery.ts");
const { saveRoster } = await import("./roster.ts");

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

assert.equal(
  DISCOVERY_PATH,
  process.env.DISCOVERY_PATH,
  "DISCOVERY_PATH must honour the env override (tests must never touch real data)"
);

// --- H02 heuristics unchanged ---------------------------------------------
for (const junk of ["", "2388", "238813", "2470262388", "ABC12345", "1234567"]) {
  check(`H02 仍拒绝脏 ID ${JSON.stringify(junk)}`, !isPlausibleDeviceId(junk));
}
check("H02 仍接受 10 位数字 7026238813", isPlausibleDeviceId("7026238813"));

// --- Ucast ids --------------------------------------------------------------
const SN = "CSX9LNY9E5FZK6LAGQZQ";
check("Ucast 接受 SN", isPlausibleUcastDeviceId(SN));
check("Ucast 接受数字别名 9990000002", isPlausibleUcastDeviceId("9990000002"));
check("Ucast 拒绝空串", !isPlausibleUcastDeviceId(""));
check("Ucast 拒绝过短 SN", !isPlausibleUcastDeviceId("ABC123"));
check("Ucast 拒绝带空格 SN", !isPlausibleUcastDeviceId("CSX9 LNY9"));

// The exact regression: this SN is what used to hit `drop ghost`.
check(
  "回归：同一条 SN 走 H02 通道仍被拒（旧的 drop ghost 就是这条）",
  !isPlausibleDeviceId(SN)
);

// --- coord gate -------------------------------------------------------------
check("拒绝 0,0", !isPlausibleCoord(0, 0));
check("拒绝境外（伦敦）", !isPlausibleCoord(51.5, -0.12));
check("接受深圳", isPlausibleCoord(22.6348, 114.0535));

// --- Ucast SN reaches pending discovery ------------------------------------
const first = noteUnknownSighting(SN, 22.6348, 114.0535, "ucast");
check("第 1 次上报不 pending", first?.pending === false, `hits=${first?.hits}`);
const second = noteUnknownSighting(SN, 22.63485, 114.05355, "ucast");
check("第 2 次上报仍不 pending", second?.pending === false, `hits=${second?.hits}`);
const third = noteUnknownSighting(SN, 22.6349, 114.0536, "ucast");
check("第 3 次上报 pending=true", third?.pending === true, `hits=${third?.hits}`);
check("来源记为 ucast", third?.origin === "ucast");
check(
  "出现在待确认列表且带来源",
  listPendingDiscovered().some((d) => d.device_id === SN && d.origin === "ucast")
);

// --- guards ----------------------------------------------------------------
check(
  "SN 走 H02 通道不产生发现记录（H02 没被放宽）",
  noteUnknownSighting("SN-VIA-H02", 22.6, 114.0, "h02") === null
);
check("坐标不合理不入库", noteUnknownSighting(SN, 51.5, -0.12, "ucast") === null);

// --- roster wins -----------------------------------------------------------
saveRoster([{ device_id: SN, bib: "9", name: "A4", color: "#fff" }]);
check("已上名册后不再记录", noteUnknownSighting(SN, 22.63, 114.05, "ucast") === null);
check(
  "已上名册后从待确认里消失",
  !listPendingDiscovered().some((d) => d.device_id === SN)
);

// --- persistence keeps origin ----------------------------------------------
saveRoster([]);
const OTHER = "AAA111BBB222";
noteUnknownSighting(OTHER, 22.63, 114.05, "ucast");
const raw = JSON.parse(fs.readFileSync(process.env.DISCOVERY_PATH!, "utf8")) as Array<{
  device_id: string;
  origin?: string;
}>;
check(
  "落盘文件保留 origin=ucast（重启后仍能区分来源）",
  raw.some((d) => d.device_id === OTHER && d.origin === "ucast")
);

// --- dismiss ---------------------------------------------------------------
dismissDiscovered(OTHER);
check(
  "忽略后从待确认移除",
  !listPendingDiscovered().some((d) => d.device_id === OTHER)
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("");
console.log(`discovery selftest: ${fail === 0 ? "OK" : "FAILED"} (${pass} passed, ${fail} failed)`);
if (fail > 0) process.exit(1);
