import { haversineM } from "../../../packages/course-project/src/geo.ts";

/** Hard-reject wild GPS jumps (running/cycling). Env-overridable. */
export const DEFAULT_MAX_SPEED_MS = Number(process.env.GPS_MAX_SPEED_MS) || 25;
export const DEFAULT_MAX_STEP_M = Number(process.env.GPS_MAX_STEP_M) || 40;
/** After this many seconds, a large step is treated as a gap reset (sleep/wake), not a spike. */
export const DEFAULT_MAX_GAP_S = Number(process.env.GPS_MAX_GAP_S) || 30;

export type AcceptedFix = { lat: number; lng: number; ts: number; recv_ms?: number };

export type JumpCheck = {
  reject: boolean;
  step_m: number;
  dt: number;
  speed_ms: number;
};

/**
 * Reject consecutive wild spikes: step_m/Δt > maxSpeedMs or step_m > maxStepM.
 * After a long gap (device Δt or receive Δt > maxGapS), accept the new point (sleep/wake).
 * Device-clock rewind (Δt ≤ 0) without a receive gap: accept to avoid permanent nail.
 */
export function checkJump(
  prev: AcceptedFix,
  next: AcceptedFix,
  maxSpeedMs = DEFAULT_MAX_SPEED_MS,
  maxStepM = DEFAULT_MAX_STEP_M,
  maxGapS = DEFAULT_MAX_GAP_S
): JumpCheck {
  const step_m = haversineM(
    { lat: prev.lat, lng: prev.lng },
    { lat: next.lat, lng: next.lng }
  );
  const deviceDt = (next.ts - prev.ts) / 1000;
  const recvDt =
    prev.recv_ms != null && next.recv_ms != null
      ? (next.recv_ms - prev.recv_ms) / 1000
      : Number.NaN;

  const afterGap =
    (Number.isFinite(deviceDt) && deviceDt > maxGapS) ||
    (Number.isFinite(recvDt) && recvDt > maxGapS);
  if (afterGap) {
    const dt =
      Number.isFinite(recvDt) && recvDt > 0
        ? recvDt
        : Number.isFinite(deviceDt) && deviceDt > 0
          ? deviceDt
          : maxGapS;
    return {
      reject: false,
      step_m,
      dt,
      speed_ms: dt > 0 ? step_m / dt : 0,
    };
  }

  if (!(deviceDt > 0) || !Number.isFinite(deviceDt)) {
    return {
      reject: false,
      step_m,
      dt: deviceDt,
      speed_ms: Number.POSITIVE_INFINITY,
    };
  }

  const speed_ms = step_m / deviceDt;
  return {
    reject: speed_ms > maxSpeedMs || step_m > maxStepM,
    step_m,
    dt: deviceDt,
    speed_ms,
  };
}
