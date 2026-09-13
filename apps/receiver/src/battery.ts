/**
 * H02 / Traccar-style batteryRaw decode.
 * Traccar H02ProtocolDecoder maps discrete levels 1–6 to percent;
 * some firmwares send 1–100 as literal percent; 0xF1–0xF6 are bar counts.
 */

export type BatteryDecode = {
  /** Approximate charge 0–100 when known. */
  battery_pct?: number;
  /** Alias of battery_pct for clients that expect `battery`. */
  battery?: number;
  /** Bar count 1–6 when raw is 0xF1–0xF6. */
  battery_bars?: number;
};

const LEVEL_PCT: Record<number, number> = {
  1: 0,
  2: 10,
  3: 20,
  4: 60,
  5: 80,
  6: 100,
};

/** Map bar count 1–6 → approximate percent (same ladder as discrete levels). */
const BAR_PCT: Record<number, number> = {
  1: 0,
  2: 10,
  3: 20,
  4: 60,
  5: 80,
  6: 100,
};

/**
 * Decode H02 batteryRaw byte / int into optional percent (and bars).
 * Returns {} when unknown.
 */
export function decodeBatteryRaw(raw: number): BatteryDecode {
  if (!Number.isFinite(raw)) return {};
  const x = Math.trunc(raw);

  // Discrete Traccar levels 1–6
  if (x >= 1 && x <= 6 && LEVEL_PCT[x] != null) {
    const pct = LEVEL_PCT[x]!;
    return { battery_pct: pct, battery: pct };
  }

  // Literal percent (some devices)
  if (x > 0 && x <= 100) {
    return { battery_pct: x, battery: x };
  }

  // Bar indicators 0xF1–0xF6 → bars 1–6
  if (x >= 0xf1 && x <= 0xf6) {
    const bars = x - 0xf0;
    const pct = BAR_PCT[bars];
    const out: BatteryDecode = { battery_bars: bars };
    if (pct != null) {
      out.battery_pct = pct;
      out.battery = pct;
    }
    return out;
  }

  return {};
}
