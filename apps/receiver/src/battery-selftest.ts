import { decodeBatteryRaw } from "./battery.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function main() {
  assert(decodeBatteryRaw(1).battery_pct === 0, "1→0%");
  assert(decodeBatteryRaw(2).battery_pct === 10, "2→10%");
  assert(decodeBatteryRaw(3).battery_pct === 20, "3→20%");
  assert(decodeBatteryRaw(4).battery_pct === 60, "4→60%");
  assert(decodeBatteryRaw(5).battery_pct === 80, "5→80%");
  assert(decodeBatteryRaw(6).battery_pct === 100, "6→100%");

  assert(decodeBatteryRaw(55).battery_pct === 55, "literal 55%");
  assert(decodeBatteryRaw(100).battery_pct === 100, "literal 100%");

  const bars = decodeBatteryRaw(0xf3);
  assert(bars.battery_bars === 3, `bars=${bars.battery_bars}`);
  assert(bars.battery_pct === 20, `bar3 pct=${bars.battery_pct}`);

  assert(decodeBatteryRaw(0).battery_pct === undefined, "0 unknown");
  assert(decodeBatteryRaw(200).battery_pct === undefined, "200 unknown");
  assert(decodeBatteryRaw(-1).battery_pct === undefined, "neg unknown");

  console.log("battery-selftest PASS");
}

main();
