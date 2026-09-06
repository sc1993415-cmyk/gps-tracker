import type { Telemetry } from "../../../packages/schema/src/telemetry.ts";

/** 绕起点小圈模拟跑步/骑行，约 1Hz */
export function startDemoPublisher(
  onTick: (t: Telemetry) => void,
  hz = 1
) {
  const origin = { lat: 31.2304, lng: 121.4737 };
  let i = 0;
  let distance = 0;
  let climb = 0;
  let prevAlt = 12;

  const timer = setInterval(() => {
    const ang = (i / 60) * Math.PI * 2;
    const lat = origin.lat + 0.0015 * Math.sin(ang);
    const lng = origin.lng + 0.002 * Math.cos(ang);
    const speed = 12 + 3 * Math.sin(i / 8); // km/h 观感
    const alt_baro = 12 + 25 * (0.5 + 0.5 * Math.sin(ang));
    distance += Math.max(speed, 0) / 3.6; // 粗算 m/s * 1s
    climb += Math.max(0, alt_baro - prevAlt);
    prevAlt = alt_baro;

    onTick({
      device_id: "demo-1",
      lat,
      lng,
      speed: Math.round(speed * 10) / 10,
      alt_baro: Math.round(alt_baro * 10) / 10,
      ts: Date.now(),
      bib: "42",
      name: "Demo",
      distance: Math.round(distance),
      climb: Math.round(climb),
    });
    i += 1;
  }, 1000 / hz);

  return () => clearInterval(timer);
}
