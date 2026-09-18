import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDemoFlightJfkLhr, buildDemoFlightJfkLhrClearSkies, buildDemoFlightBosDub } from "../demoFlights.js";
import { haversineMeters } from "../../utils/geo.js";

test("buildDemoFlightJfkLhr: starts and ends at the named airports", () => {
  const flight = buildDemoFlightJfkLhr();
  const first = flight.trajectory[0]!;
  const last = flight.trajectory[flight.trajectory.length - 1]!;
  assert.ok(haversineMeters(first.latitude, first.longitude, 40.6413, -73.7781) < 5000);
  assert.ok(haversineMeters(last.latitude, last.longitude, 51.47, -0.4543) < 5000);
});

test("buildDemoFlightJfkLhr: altitude profile never jumps unrealistically between adjacent 60s samples", () => {
  const flight = buildDemoFlightJfkLhr();
  const maxDeltaPerMin = 2500; // generous ceiling for a smoothstep-eased synthetic profile
  for (let i = 1; i < flight.trajectory.length; i++) {
    const delta = Math.abs(flight.trajectory[i]!.altitudeFt - flight.trajectory[i - 1]!.altitudeFt);
    assert.ok(delta <= maxDeltaPerMin, `altitude jumped ${delta}ft in one sample at index ${i}`);
  }
});

test("buildDemoFlightJfkLhr: reaches cruise altitude and returns near ground at the end", () => {
  const flight = buildDemoFlightJfkLhr();
  const maxAlt = Math.max(...flight.trajectory.map((p) => p.altitudeFt));
  const lastAlt = flight.trajectory[flight.trajectory.length - 1]!.altitudeFt;
  assert.ok(maxAlt >= 37000, `expected to reach FL380ish, got max ${maxAlt}`);
  assert.ok(lastAlt < 5000, `expected near-ground altitude at arrival, got ${lastAlt}`);
});

test("buildDemoFlightJfkLhr: is explicitly labeled as reconstructed, not raw telemetry", () => {
  const flight = buildDemoFlightJfkLhr();
  assert.equal(flight.dataProvenance.source, "reconstructed-representative");
  assert.ok(flight.dataProvenance.note.length > 20);
});

test("buildDemoFlightJfkLhr: timestamps are strictly increasing", () => {
  const flight = buildDemoFlightJfkLhr();
  for (let i = 1; i < flight.trajectory.length; i++) {
    const t0 = new Date(flight.trajectory[i - 1]!.timestamp).getTime();
    const t1 = new Date(flight.trajectory[i]!.timestamp).getTime();
    assert.ok(t1 > t0);
  }
});

test("all three demo flights build without throwing and have plausible waypoint counts", () => {
  for (const builder of [buildDemoFlightJfkLhr, buildDemoFlightJfkLhrClearSkies, buildDemoFlightBosDub]) {
    const flight = builder();
    assert.ok(flight.trajectory.length > 100);
    assert.ok(flight.trajectory.length < 1000);
  }
});
