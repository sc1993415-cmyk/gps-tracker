export type Telemetry = {
  device_id: string;
  lat: number;
  lng: number;
  speed: number;
  alt_baro: number;
  ts: number;
  bib: string;
  name: string;
  distance: number;
  climb: number;
  /** Optional course/heading in degrees (0–360), e.g. from GPRMC */
  heading?: number;
  /** Battery percent 0–100 when known (H02 batteryRaw decode). */
  battery_pct?: number;
  /** Alias of battery_pct. */
  battery?: number;
  /** Bar count 1–6 when device reports 0xF1–0xF6. */
  battery_bars?: number;
  /** Raw GPS before course snap (WGS84). */
  raw_lat?: number;
  raw_lng?: number;
};
