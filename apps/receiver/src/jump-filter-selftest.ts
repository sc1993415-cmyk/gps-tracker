import { checkJump } from "./jump-filter.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const t0 = Date.parse("2026-09-08T10:53:44.000Z");
const prev = { lat: 32.04811, lng: 118.74196, ts: t0, recv_ms: 1_000_000 };

// Normal ~2 m / 1 s walk — accept
{
  const next = { lat: 32.04813, lng: 118.74196, ts: t0 + 1000, recv_ms: 1_001_000 };
  const r = checkJump(prev, next);
  assert(!r.reject, `normal should accept speed=${r.speed_ms} step=${r.step_m}`);
}

// Historical 77 m / 1 s wild point — reject
{
  const next = { lat: 32.04749, lng: 118.74159, ts: t0 + 1000, recv_ms: 1_001_000 };
  const r = checkJump(prev, next);
  assert(r.reject, `77m jump should reject step=${r.step_m}`);
  assert(r.step_m > 40, `step_m=${r.step_m}`);
  assert(r.speed_ms > 25, `speed=${r.speed_ms}`);
}

// Fast but legal cycling ~11 m/s — accept
{
  const next = { lat: 32.04821, lng: 118.74196, ts: t0 + 1000, recv_ms: 1_001_000 };
  const r = checkJump(prev, next);
  assert(!r.reject, `11m/s should accept step=${r.step_m} speed=${r.speed_ms}`);
}

// ~600 m after ~640 s gap (sleep/wake) — accept, do not nail
{
  const next = {
    lat: 32.04651,
    lng: 118.73645,
    ts: t0 + 640_000,
    recv_ms: 1_000_000 + 640_000,
  };
  const r = checkJump(prev, next);
  assert(!r.reject, `gap jump should accept step=${r.step_m} dt=${r.dt}`);
  assert(r.step_m > 500, `expected large step got ${r.step_m}`);
}

// Device clock rewind with large step — accept (no permanent nail)
{
  const next = {
    lat: 32.04806,
    lng: 118.74256,
    ts: t0 - 600_000,
    recv_ms: 1_000_000 + 8 * 60_000,
  };
  const r = checkJump(prev, next);
  assert(!r.reject, `clock rewind should accept step=${r.step_m} dt=${r.dt}`);
}

console.log("jump-filter-selftest PASS");
