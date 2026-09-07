import { haversineM } from "./geo.ts";

const a = { lat: 31.2304, lng: 121.4737 };
const b = { lat: 31.2305, lng: 121.4738 };
const d = haversineM(a, b);
if (!(d > 0)) {
  console.error("selftest failed: haversineM expected > 0, got", d);
  process.exit(1);
}
console.log("ok haversineM", d.toFixed(2), "m");
