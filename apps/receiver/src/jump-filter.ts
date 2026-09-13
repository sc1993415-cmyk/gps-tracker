import { haversineM } from "../../../packages/course-project/src/geo.ts";

/** Hard-reject wild GPS jumps (running/cycling). Env-overridable. */
export const DEFAULT_MAX_SPEED_MS = Number(process.env.GPS_MAX_SPEED_MS) || 25;
export const DEFAULT_MAX_STEP_M = Number(process.env.GPS_MAX_STEP_M) || 40;
/** Receive gap above this → accept & reset (sleep/wake). */
export const DEFAULT_MAX_GAP_S = Number(process.env.GPS_MAX_GAP_S) || 30;
/** Only reject wild spikes when recv Δt is within this window (1Hz). */
export const DEFAULT_SPIKE_WINDOW_S = Number(process.env.GPS_SPIKE_WINDOW_S) || 3;

export type AcceptedFix = { lat: number; lng: number; ts: number; recv_ms?: number };

export type JumpCheck = {
  reject: boolean;
  step_m: number;
  dt: number;
  speed_ms: number;
};

/**
 * Clamp using server receive time, never broken device clock for step/Δt.
 * - recvΔt > maxGapS, or device ts rewind/junk → accept (reset lastAccepted)
 * - only when 0 < recvΔt ≤ spikeWindowS → reject if speed or step too high
 * - mid gaps (spikeWindowS < recvΔt ≤ maxGapS) → accept
 */
export function checkJump(
  prev: AcceptedFix,
  next: AcceptedFix,
  maxSpeedMs = DEFAULT_MAX_SPEED_MS,
  maxStepM = DEFAULT_MAX_STEP_M,
  maxGapS = DEFAULT_MAX_GAP_S,
  spikeWindowS = DEFAULT_SPIKE_WINDOW_S
): JumpCheck {
  const step_m = haversineM(
    { lat: prev.lat, lng: prev.lng },
    { lat: next.lat, lng: next.lng }
  );
  const deviceDt = (next.ts - prev.ts) / 1000;
  const hasRecv =
    prev.recv_ms != null &&
    next.recv_ms != null &&
    Number.isFinite(prev.recv_ms) &&
    Number.isFinite(next.recv_ms);
  const recvDt = hasRecv ? (next.recv_ms! - prev.recv_ms!) / 1000 : Number.NaN;

  const deviceRewind = !(deviceDt > 0) || !Number.isFinite(deviceDt);

  // Prefer receive Δt; if missing, do not invent speed from bad device clock.
  if (!hasRecv || !(recvDt > 0) || !Number.isFinite(recvDt) || deviceRewind) {
    return {
      reject: false,
      step_m,
      dt: Number.isFinite(recvDt) ? recvDt : deviceDt,
      speed_ms: 0,
    };
  }

  if (recvDt > maxGapS) {
    return {
      reject: false,
      step_m,
      dt: recvDt,
      speed_ms: step_m / recvDt,
    };
  }

  // Mid gap: accept without spike rules.
  if (recvDt > spikeWindowS) {
    return {
      reject: false,
      step_m,
      dt: recvDt,
      speed_ms: step_m / recvDt,
    };
  }

  const speed_ms = step_m / recvDt;
  return {
    reject: speed_ms > maxSpeedMs || step_m > maxStepM,
    step_m,
    dt: recvDt,
    speed_ms,
  };
}
