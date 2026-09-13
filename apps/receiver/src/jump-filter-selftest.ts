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

// Historical 77 m / 1 s wild point — reject (recv Δt = 1s)
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

// ~600 m after ~640 s receive gap — accept
{
  const next = {
    lat: 32.04651,
    lng: 118.73645,
    ts: t0 + 640_000,
    recv_ms: 1_000_000 + 640_000,
  };
  const r = checkJump(prev, next);
  assert(!r.reject, `gap jump should accept step=${r.step_m} dt=${r.dt}`);
}

// Device clock rewind + large step, but receive gap large — accept
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

// 50 m over 10 s receive gap — mid gap, accept (no 40m nail)
{
  const next = {
    lat: 32.04856,
    lng: 118.74196,
    ts: t0 + 10_000,
    recv_ms: 1_000_000 + 10_000,
  };
  const r = checkJump(prev, next);
  assert(!r.reject, `mid-gap 50m/10s should accept dt=${r.dt} step=${r.step_m}`);
}

// Burst: ~1.1 m in 2 ms must ACCEPT (was false nail at "500 m/s")
{
  const next = {
    lat: 32.04812,
    lng: 118.74196,
    ts: t0 + 1000,
    recv_ms: 1_000_002,
  };
  const r = checkJump(prev, next);
  assert(!r.reject, `burst 1m/2ms should accept step=${r.step_m} dt=${r.dt} speed=${r.speed_ms}`);
}

// Burst teleport 50 m in 2 ms — still reject via step
{
  const next = {
    lat: 32.04856,
    lng: 118.74196,
    ts: t0 + 1000,
    recv_ms: 1_000_002,
  };
  const r = checkJump(prev, next);
  assert(r.reject, `burst 50m/2ms should reject step=${r.step_m}`);
}

console.log("jump-filter-selftest PASS");
