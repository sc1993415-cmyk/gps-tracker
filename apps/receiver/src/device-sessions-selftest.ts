import { buildMt909Command } from "./device-sessions.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(buildMt909Command("cq") === "CQ", "cq");
assert(buildMt909Command("freq", { password: "123456", intervalSec: 30 }) === "FREQ,123456,30", "freq");
assert(buildMt909Command("freq", { password: "123456", intervalSec: 1 }) === "FREQ,123456,1", "freq1");
assert(buildMt909Command("ip", { host: "114.55.99.34", port: 5013 }) === "IP 114.55.99.34 5013", "ip");
let threw = false;
try { buildMt909Command("freq", { intervalSec: 0 }); } catch { threw = true; }
assert(threw, "freq min");
console.log("device-sessions-selftest PASS");
