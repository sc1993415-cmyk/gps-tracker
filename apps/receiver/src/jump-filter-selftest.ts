import { checkJump } from "./jump-filter.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const t0 = Date.parse("2026-09-08T10:53:44.000Z");
const prev = { lat: 32.04811, lng: 118.74196, ts: t0 };

// Normal ~2 m / 1 s walk — accept
{
  const next = { lat: 32.04813, lng: 118.74196, ts: t0 + 1000 };
  const r = checkJump(prev, next);
  assert(!r.reject, `normal should accept speed=${r.speed_ms} step=${r.step_m}`);
}

// Historical 77 m / 1 s wild point — reject
{
  const next = { lat: 32.04749, lng: 118.74159, ts: t0 + 1000 };
  const r = checkJump(prev, next);
  assert(r.reject, `77m jump should reject step=${r.step_m}`);
  assert(r.step_m > 40, `step_m=${r.step_m}`);
  assert(r.speed_ms > 25, `speed=${r.speed_ms}`);
}

// Fast but legal cycling ~11 m/s — accept
{
  const next = { lat: 32.04821, lng: 118.74196, ts: t0 + 1000 }; // ~11 m north
  const r = checkJump(prev, next);
  assert(!r.reject, `11m/s should accept step=${r.step_m} speed=${r.speed_ms}`);
}

console.log("jump-filter-selftest PASS");
