/** Drop reconnect buffer replays / clock rewind using device_ts vs recv & last accepted. */

export const DEFAULT_MAX_DEVICE_LAG_S = 120;
export const DEFAULT_MAX_DEVICE_REWIND_S = 30;

export type StaleCheck = {
  drop: boolean;
  reason?: "lag" | "rewind";
  lag_s: number;
  rewind_s: number;
};

/**
 * @param deviceTsMs device packet timestamp (epoch ms)
 * @param recvMs server receive time (epoch ms)
 * @param lastAcceptedDeviceTsMs last accepted device_ts for this id, if any
 */
export function checkStaleDeviceTs(
  deviceTsMs: number,
  recvMs: number,
  lastAcceptedDeviceTsMs?: number,
  maxLagS = DEFAULT_MAX_DEVICE_LAG_S,
  maxRewindS = DEFAULT_MAX_DEVICE_REWIND_S
): StaleCheck {
  const lag_s = (recvMs - deviceTsMs) / 1000;
  if (!Number.isFinite(deviceTsMs) || !Number.isFinite(recvMs)) {
    return { drop: true, reason: "lag", lag_s: Number.POSITIVE_INFINITY, rewind_s: 0 };
  }
  if (lag_s > maxLagS) {
    return { drop: true, reason: "lag", lag_s, rewind_s: 0 };
  }
  let rewind_s = 0;
  if (
    lastAcceptedDeviceTsMs != null &&
    Number.isFinite(lastAcceptedDeviceTsMs)
  ) {
    rewind_s = (lastAcceptedDeviceTsMs - deviceTsMs) / 1000;
    if (rewind_s > maxRewindS) {
      return { drop: true, reason: "rewind", lag_s, rewind_s };
    }
  }
  return { drop: false, lag_s, rewind_s };
}
