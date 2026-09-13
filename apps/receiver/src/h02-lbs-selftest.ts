import assert from "node:assert/strict";
import { decodeH02Binary, H02_MESSAGE_SHORT } from "./h02-tcp.ts";
import { LBS_FRAME_LEN, parseLbs, looksLikeLbs, fullHex } from "./h02-lbs.ts";
import {
  type DeviceFixState,
  noteGps,
  noteLbs,
  selectFix,
  isUsableGps,
} from "./h02-fix-select.ts";

/** Real truncated journal LBS prefix (24B) padded to 41B with zeros — trailing TODO. */
const LBS_PREFIX_HEX = "0001cc00500b000013000000000000000000000000000000";
const lbs41 = Buffer.concat([
  Buffer.from(LBS_PREFIX_HEX, "hex"),
  Buffer.alloc(LBS_FRAME_LEN - LBS_PREFIX_HEX.length / 2, 0),
]);
assert.equal(lbs41.length, 41);

// Sample H02 from user log (valid=false, old ts)
const H02_OLD_HEX =
  "247026238813104628080926320288645d118445176c000000f7fffbff000000";
const h02old = Buffer.from(H02_OLD_HEX, "hex");
assert.equal(h02old.length, H02_MESSAGE_SHORT);

// Build a minimal valid-looking short frame by decoding old and checking length path
const posOld = decodeH02Binary(h02old);
assert.ok(posOld, "decode old h02");
assert.equal(posOld!.valid, false);
assert.equal(posOld!.device_id, "7026238813");

// --- 1) pure 32B H02 ---
{
  const p = decodeH02Binary(h02old);
  assert.ok(p);
  assert.equal(p!.device_id, "7026238813");
}

// --- 2) pure 41B LBS ---
{
  assert.equal(looksLikeLbs(lbs41), true);
  const cell = parseLbs(lbs41);
  assert.ok(cell);
  assert.equal(cell!.mcc, 460);
  assert.equal(cell!.mnc, 0);
  assert.equal(cell!.lac, 0x500b);
  assert.equal(cell!.ci, 0x00001300);
  assert.equal(cell!.rawHex.length, 82); // 41 bytes
}

// --- 3) H02+LBS glued ---
{
  const glued = Buffer.concat([h02old, lbs41]);
  assert.equal(glued[0], 0x24);
  const gps = decodeH02Binary(glued.subarray(0, 32));
  assert.ok(gps);
  const rest = glued.subarray(32);
  assert.equal(rest.length, 41);
  assert.equal(looksLikeLbs(rest), true);
  const cell = parseLbs(rest);
  assert.ok(cell);
  assert.equal(cell!.mcc, 460);
}

// --- 4) half packet then remainder ---
{
  const part1 = lbs41.subarray(0, 10);
  const part2 = lbs41.subarray(10);
  assert.equal(looksLikeLbs(part1), true);
  assert.equal(part1.length < LBS_FRAME_LEN, true);
  const merged = Buffer.concat([part1, part2]);
  assert.equal(merged.length, 41);
  const cell = parseLbs(merged);
  assert.ok(cell);
  assert.equal(cell!.mcc, 460);
}

// --- 5) old GPS valid=false + new LBS → source=lbs ---
{
  const st: DeviceFixState = {};
  const recvGps = Date.now();
  noteGps(st, posOld!, fullHex(h02old), recvGps);
  assert.equal(isUsableGps(posOld!, recvGps), false);
  noteLbs(st, parseLbs(lbs41)!, recvGps + 1);
  const fused = selectFix(st, recvGps + 1);
  assert.ok(fused);
  assert.equal(fused!.source, "lbs");
  assert.equal(fused!.mcc, 460);
  assert.equal(fused!.lac, 0x500b);
}

console.log("h02-lbs-selftest: ok");
