import assert from "node:assert/strict";
import { checkStaleDeviceTs } from "./stale-ts.ts";

const recv = Date.parse("2026-09-13T11:28:23.000Z");

// fresh packet OK
{
  const r = checkStaleDeviceTs(recv - 1000, recv, recv - 2000);
  assert.equal(r.drop, false, `fresh should accept lag=${r.lag_s}`);
}

// lag > 120s drop (reconnect buffer ~31 min)
{
  const old = Date.parse("2026-09-13T10:57:10.000Z");
  const r = checkStaleDeviceTs(old, recv, Date.parse("2026-09-13T11:26:50.000Z"));
  assert.equal(r.drop, true);
  assert.equal(r.reason, "lag");
  assert.ok(r.lag_s > 120, `lag=${r.lag_s}`);
}

// device_ts rewind > 30s vs last accepted
{
  const last = Date.parse("2026-09-13T11:28:17.000Z");
  const back = Date.parse("2026-09-13T11:26:49.000Z"); // ~88s rewind but lag small if recv close
  const r = checkStaleDeviceTs(back, back + 500, last);
  assert.equal(r.drop, true);
  assert.equal(r.reason, "rewind");
  assert.ok(r.rewind_s > 30, `rewind=${r.rewind_s}`);
}

// small rewind OK (clock jitter)
{
  const last = recv - 1000;
  const r = checkStaleDeviceTs(last - 5000, recv, last); // 5s rewind
  assert.equal(r.drop, false, `5s rewind ok rewind=${r.rewind_s}`);
}

console.log("stale-ts-selftest: ok");
