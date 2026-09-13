import { haversineM } from "../../../packages/course-project/src/geo.ts";

/** Hard-reject wild GPS jumps (running/cycling). Env-overridable. */
export const DEFAULT_MAX_SPEED_MS = Number(process.env.GPS_MAX_SPEED_MS) || 25;
export const DEFAULT_MAX_STEP_M = Number(process.env.GPS_MAX_STEP_M) || 40;

export type AcceptedFix = { lat: number; lng: number; ts: number };

export type JumpCheck = {
  reject: boolean;
  step_m: number;
  dt: number;
  speed_ms: number;
};

/**
 * Reject if step_m/Δt > maxSpeedMs (~90 km/h at 25) or step_m > maxStepM.
 * Δt ≤ 0 (dup/rewind ts): reject only when step_m > maxStepM.
 */
export function checkJump(
  prev: AcceptedFix,
  next: AcceptedFix,
  maxSpeedMs = DEFAULT_MAX_SPEED_MS,
  maxStepM = DEFAULT_MAX_STEP_M
): JumpCheck {
  const step_m = haversineM(
    { lat: prev.lat, lng: prev.lng },
    { lat: next.lat, lng: next.lng }
  );
  const dt = (next.ts - prev.ts) / 1000;
  if (!(dt > 0) || !Number.isFinite(dt)) {
    return {
      reject: step_m > maxStepM,
      step_m,
      dt,
      speed_ms: Number.POSITIVE_INFINITY,
    };
  }
  const speed_ms = step_m / dt;
  return {
    reject: speed_ms > maxSpeedMs || step_m > maxStepM,
    step_m,
    dt,
    speed_ms,
  };
}
