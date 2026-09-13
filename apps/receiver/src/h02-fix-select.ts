import type { H02BinaryPosition } from "./h02-tcp.ts";
import type { LbsCell } from "./h02-lbs.ts";

export const GPS_MAX_AGE_MS = 10 * 60 * 1000;
export const GPS_STALE_FOR_LBS_MS = 30_000;
export const LBS_MAX_AGE_MS = 120_000;

export type FixSource = "gps" | "lbs";

export type FusedFix = {
  id: string;
  source: FixSource;
  lat?: number;
  lng?: number;
  valid: boolean;
  ts: number;
  mcc?: number;
  mnc?: number;
  lac?: number;
  ci?: number;
  rawHex: string;
  speedKmh?: number;
  course?: number;
  batteryRaw?: number;
};

export type DeviceFixState = {
  lastGps?: { pos: H02BinaryPosition; recvMs: number; rawHex: string };
  lastLbs?: { cell: LbsCell; recvMs: number };
};

export function isUsableGps(
  pos: H02BinaryPosition,
  recvMs: number,
  now = Date.now()
): boolean {
  if (!pos.valid) return false;
  if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return false;
  if (pos.lat === 0 && pos.lng === 0) return false;
  if (Math.abs(pos.lat) < 1e-9 && Math.abs(pos.lng) < 1e-9) return false;
  if (!Number.isFinite(pos.ts)) return false;
  if (Math.abs(now - pos.ts) >= GPS_MAX_AGE_MS) return false;
  // also reject if receive skew vs device ts is wild (same 10min)
  if (Math.abs(recvMs - pos.ts) >= GPS_MAX_AGE_MS) return false;
  return true;
}

export function noteGps(
  state: DeviceFixState,
  pos: H02BinaryPosition,
  rawHex: string,
  recvMs = Date.now()
) {
  state.lastGps = { pos, recvMs, rawHex };
}

export function noteLbs(state: DeviceFixState, cell: LbsCell, recvMs = Date.now()) {
  state.lastLbs = { cell, recvMs };
}

/**
 * Choose fused output after a GPS and/or LBS update.
 * Never let valid=false / stale GPS cover fresher LBS.
 */
export function selectFix(
  state: DeviceFixState,
  now = Date.now()
): FusedFix | null {
  const gps = state.lastGps;
  const lbs = state.lastLbs;

  const gpsOk = gps ? isUsableGps(gps.pos, gps.recvMs, now) : false;
  if (gpsOk && gps) {
    return {
      id: gps.pos.device_id,
      source: "gps",
      lat: gps.pos.lat,
      lng: gps.pos.lng,
      valid: true,
      ts: gps.pos.ts,
      rawHex: gps.rawHex,
      speedKmh: gps.pos.speedKmh,
      course: gps.pos.course,
      batteryRaw: gps.pos.batteryRaw,
      mcc: lbs?.cell.mcc,
      mnc: lbs?.cell.mnc,
      lac: lbs?.cell.lac,
      ci: lbs?.cell.ci,
    };
  }

  const lbsFresh =
    !!lbs && now - lbs.recvMs <= LBS_MAX_AGE_MS;
  const noGpsFor =
    !gps || now - gps.recvMs >= GPS_STALE_FOR_LBS_MS || !gpsOk;

  if (lbsFresh && noGpsFor && lbs) {
    const id = gps?.pos.device_id || "";
    return {
      id,
      source: "lbs",
      // no cell DB yet — coordinates omitted (TODO OpenCelliD)
      valid: false,
      ts: lbs.recvMs,
      mcc: lbs.cell.mcc,
      mnc: lbs.cell.mnc,
      lac: lbs.cell.lac,
      ci: lbs.cell.ci,
      rawHex: lbs.cell.rawHex,
    };
  }

  return null;
}
