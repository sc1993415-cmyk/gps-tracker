import {
  decodeH02Binary,
  h02PositionToTelemetry,
  detectH02FrameLength,
} from "./h02-tcp.ts";

/** Real MT909 short frame sample (id 7026238813 ≈ 32.047 / 118.742 / course 139). */
const REAL_HEX =
  "247026238813083227080926320283565e118445336e000139f7fffbff000000";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function main() {
  const real = Buffer.from(REAL_HEX, "hex");
  assert(real.length === 32, `expected 32-byte sample, got ${real.length}`);

  const pos = decodeH02Binary(real);
  assert(pos, "real frame decode failed");
  assert(pos.device_id === "7026238813", `id=${pos.device_id}`);
  assert(Math.abs(pos.lat - 32.04726) < 1e-4, `lat=${pos.lat}`);
  assert(Math.abs(pos.lng - 118.74223) < 1e-4, `lng=${pos.lng}`);
  assert(Math.abs(pos.course - 139) < 0.1, `course=${pos.course}`);
  const tel = h02PositionToTelemetry(pos);
  assert(tel, "real telemetry null");

  // Doubled `$` prefix: old decoder would invent id 2470262388 + absurd lng.
  const doubled = Buffer.concat([Buffer.from([0x24]), real]);
  // Simulate server collapse: skip while doubled
  let buf = Buffer.from(doubled);
  while (buf.length >= 2 && buf[0] === 0x24 && buf[1] === 0x24) buf = buf.subarray(1);
  const len = detectH02FrameLength(buf, 0);
  assert(len === 32, `frameLen=${len}`);
  const fixed = decodeH02Binary(buf.subarray(0, len!));
  assert(fixed && fixed.device_id === "7026238813", `fixed id=${fixed?.device_id}`);

  // Raw mis-synced 32-byte window starting at first of 2424… must not publish.
  const ghostWindow = doubled.subarray(0, 32);
  const ghost = decodeH02Binary(ghostWindow);
  if (ghost) {
    const bad = h02PositionToTelemetry(ghost);
    assert(!bad, `ghost telemetry leaked id=${ghost.device_id} lng=${ghost.lng}`);
  }

  console.log("h02-selftest PASS");
}

main();
