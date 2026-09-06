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
};
