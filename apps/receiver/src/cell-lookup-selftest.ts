import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import {
  lookupCell,
  loadDb,
  loadDbFromCsvText,
  resetCellDbForTests,
  ensureCellDbLoaded,
  getCellDbStats,
} from "./cell-lookup.ts";

const FIXTURE = [
  // radio,mcc,mnc,lac,cellid,unit,lon,lat,range,...
  "GSM,460,0,100,1,0,118.70,32.00,1000,1",
  "GSM,460,0,100,2,0,118.80,32.10,1000,1",
  "GSM,460,1,100,9,0,119.00,33.00,1000,1", // same lac, different mnc
  "GSM,460,0,200,5,0,120.00,31.00,500,1",
].join("\n");

resetCellDbForTests();
loadDbFromCsvText(FIXTURE);

// Exact CI fine-tune
{
  const hit = lookupCell(460, 0, 200, 5);
  assert.ok(hit);
  assert.equal(hit!.match, "exact");
  assert.equal(hit!.lat, 31);
  assert.equal(hit!.lng, 120);
}

// Primary LAC centroid (mcc:mnc:lac) — ignore missing/unknown ci
{
  const hit = lookupCell(460, 0, 100, 99999);
  assert.ok(hit);
  assert.equal(hit!.match, "lac");
  assert.ok(Math.abs(hit!.lat - 32.05) < 1e-9);
  assert.ok(Math.abs(hit!.lng - 118.75) < 1e-9);
}

// Without ci still LAC
{
  const hit = lookupCell(460, 0, 100);
  assert.ok(hit);
  assert.equal(hit!.match, "lac");
}

// lac_any_mnc: mcc+lac known under different mnc only
{
  // fabricate: lac 300 only under mnc=1
  resetCellDbForTests();
  loadDbFromCsvText("GSM,460,1,300,1,0,118.5,32.5,1000,1");
  const hit = lookupCell(460, 0, 300, 1);
  assert.ok(hit);
  assert.equal(hit!.match, "lac_any_mnc");
  assert.equal(hit!.lat, 32.5);
  assert.equal(hit!.lng, 118.5);
}

// Miss
{
  resetCellDbForTests();
  loadDbFromCsvText(FIXTURE);
  assert.equal(lookupCell(999, 0, 1, 1), null);
  assert.equal(lookupCell(460, 0, 99999), null);
}

// Real gz if present: 460/0/20491 → Nanjing-ish via lac (ci ignored)
const gzCandidates = [
  path.join(process.cwd(), "apps/receiver/data/opencellid-460.csv.gz"),
  path.join(process.cwd(), "data/opencellid-460.csv.gz"),
];
const gz = gzCandidates.find((p) => fs.existsSync(p));
if (gz) {
  resetCellDbForTests();
  const n = loadDb(gz);
  assert.ok(n > 1000, `expected many rows, got ${n}`);
  const hit = lookupCell(460, 0, 20491, 5120);
  assert.ok(hit, "460/0/20491 must resolve via LAC");
  assert.equal(hit!.match, "lac"); // CI 5120 typically absent → lac
  assert.ok(Number.isFinite(hit!.lat) && Number.isFinite(hit!.lng));
  // ~Nanjing
  assert.ok(Math.abs(hit!.lng - 118.75) < 0.15, `lng=${hit!.lng}`);
  assert.ok(Math.abs(hit!.lat - 32.04) < 0.15, `lat=${hit!.lat}`);
  console.log(
    `real-db lac=20491 match=${hit!.match} lat=${hit!.lat.toFixed(4)} lng=${hit!.lng.toFixed(4)} rows=${getCellDbStats().rows}`
  );
} else {
  console.log("skip real gz (not found)");
}

resetCellDbForTests();
ensureCellDbLoaded(); // smoke: default path load
console.log("cell-lookup-selftest: ok");
