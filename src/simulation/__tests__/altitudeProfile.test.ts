import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAltitudeWindow, findCruiseRange, DEFAULT_KINEMATIC_ASSUMPTIONS } from "../altitudeProfile.js";
import type { TrajectoryPoint } from "../../models/flight.js";

function buildCruiseTrajectory(count: number, spacingSec: number, altitudeFt = 36000): TrajectoryPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(i * spacingSec * 1000).toISOString(),
    latitude: 45 + i * 0.05,
    longitude: -40 + i * 0.2,
    altitudeFt,
    interpolated: false,
  }));
}

test("applyAltitudeWindow: no jump larger than the assumed rate allows between adjacent samples", () => {
  const points = buildCruiseTrajectory(120, 60); // 2 hours, 1-min spacing
  const { altitudes } = applyAltitudeWindow(points, {
    startIndex: 60,
    endIndex: 70,
    offsetFt: -2000,
    permanent: false,
  });

  const maxDeltaPerMinute = Math.max(
    DEFAULT_KINEMATIC_ASSUMPTIONS.climbRateFtPerMin,
    DEFAULT_KINEMATIC_ASSUMPTIONS.descentRateFtPerMin,
  );
  for (let i = 1; i < altitudes.length; i++) {
    const delta = Math.abs(altitudes[i]! - altitudes[i - 1]!);
    assert.ok(delta <= maxDeltaPerMinute + 1e-6, `step ${i} changed by ${delta} ft in one minute, exceeding assumed max rate`);
  }
});

test("applyAltitudeWindow: holds the full offset exactly through the window", () => {
  const points = buildCruiseTrajectory(120, 60);
  const { altitudes } = applyAltitudeWindow(points, {
    startIndex: 60,
    endIndex: 70,
    offsetFt: -2000,
    permanent: false,
  });
  for (let i = 60; i <= 70; i++) {
    assert.equal(altitudes[i], 34000);
  }
});

test("applyAltitudeWindow: returns to original altitude well after the window when not permanent", () => {
  const points = buildCruiseTrajectory(120, 60);
  const { altitudes } = applyAltitudeWindow(points, {
    startIndex: 60,
    endIndex: 70,
    offsetFt: -2000,
    permanent: false,
  });
  assert.equal(altitudes[altitudes.length - 1], 36000);
});

test("applyAltitudeWindow: permanent offset never returns to baseline", () => {
  const points = buildCruiseTrajectory(60, 60);
  const { altitudes } = applyAltitudeWindow(points, {
    startIndex: 10,
    endIndex: 59,
    offsetFt: 2000,
    permanent: true,
  });
  assert.equal(altitudes[altitudes.length - 1], 38000);
});

test("applyAltitudeWindow: flags infeasibility when there isn't enough trajectory before the window to ramp in", () => {
  const points = buildCruiseTrajectory(20, 60); // only 20 minutes total
  const { feasibility } = applyAltitudeWindow(points, {
    startIndex: 1, // almost no time to ramp
    endIndex: 5,
    offsetFt: -4000, // needs ~5 min at 800ft/min descent... actually check rate
    permanent: false,
  });
  assert.equal(feasibility.withinKinematicLimits, false);
  assert.ok(feasibility.notes.length > 0);
});

test("applyAltitudeWindow: flags exceeding the assumed service ceiling", () => {
  const points = buildCruiseTrajectory(30, 60, 42000);
  const { feasibility } = applyAltitudeWindow(points, {
    startIndex: 10,
    endIndex: 15,
    offsetFt: 3000, // 45000 ft exceeds the 43000 ft default ceiling
    permanent: false,
  });
  assert.equal(feasibility.withinServiceCeiling, false);
});

test("findCruiseRange: identifies the above-floor segment and excludes climb/descent", () => {
  const climb = [
    { timestamp: "t0", latitude: 40, longitude: -73, altitudeFt: 5000, interpolated: false },
    { timestamp: "t1", latitude: 41, longitude: -72, altitudeFt: 15000, interpolated: false },
  ];
  const cruise = buildCruiseTrajectory(10, 60, 36000);
  const descent = [
    { timestamp: "t2", latitude: 51, longitude: -1, altitudeFt: 12000, interpolated: false },
  ];
  const full = [...climb, ...cruise, ...descent];
  const range = findCruiseRange(full, 20000);
  assert.equal(range?.startIndex, climb.length);
  assert.equal(range?.endIndex, climb.length + cruise.length - 1);
});
