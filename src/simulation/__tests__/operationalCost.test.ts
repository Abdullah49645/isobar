import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateOperationalCost } from "../operationalCost.js";
import { AIRCRAFT_CATALOG, JET_FUEL_CO2_FACTOR_KG_PER_KG } from "../../models/aircraftCatalog.js";
import type { TrajectoryPoint } from "../../models/flight.js";

const aircraft = AIRCRAFT_CATALOG.B789!;

function level(count: number, altitudeFt: number, groundSpeedKts = 488): TrajectoryPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(i * 60_000).toISOString(),
    latitude: 45,
    longitude: -40 + i * 0.2,
    altitudeFt,
    groundSpeedKts,
    interpolated: false,
  }));
}

test("estimateOperationalCost: identical baseline and counterfactual altitude yields ~zero fuel and time delta", () => {
  const baseline = level(30, 36000);
  const result = estimateOperationalCost(baseline, baseline, aircraft);
  assert.ok(Math.abs(result.fuelDeltaKg) < 1e-6);
  assert.ok(Math.abs(result.timeDeltaSec) < 1e-6);
});

test("estimateOperationalCost: fuel penalty is symmetric in sign but grows with |offset|", () => {
  const baseline = level(30, 36000);
  const down2000 = level(30, 34000);
  const up2000 = level(30, 38000);
  const down4000 = level(30, 32000);

  const rDown2000 = estimateOperationalCost(baseline, down2000, aircraft);
  const rUp2000 = estimateOperationalCost(baseline, up2000, aircraft);
  const rDown4000 = estimateOperationalCost(baseline, down4000, aircraft);

  assert.ok(rDown2000.fuelDeltaKg > 0, "any deviation from actual altitude costs fuel in this simplified model");
  assert.ok(rUp2000.fuelDeltaKg > 0);
  // Same magnitude offset in either direction -> same fuel penalty (documented symmetric simplification).
  assert.ok(Math.abs(rDown2000.fuelDeltaKg - rUp2000.fuelDeltaKg) < 1e-6);
  // Doubling the offset should roughly quadruple the penalty (parabolic).
  const ratio = rDown4000.fuelDeltaKg / rDown2000.fuelDeltaKg;
  assert.ok(ratio > 3.5 && ratio < 4.5, `expected ~4x penalty for 2x offset, got ${ratio}`);
});

test("estimateOperationalCost: CO2 delta always equals fuel delta times the documented emission factor", () => {
  const baseline = level(30, 36000);
  const counterfactual = level(30, 33000);
  const result = estimateOperationalCost(baseline, counterfactual, aircraft);
  assert.ok(
    Math.abs(result.co2DeltaKg - result.fuelDeltaKg * JET_FUEL_CO2_FACTOR_KG_PER_KG) < 1e-6,
  );
});

test("estimateOperationalCost: climbing (holding Mach constant) costs time below the tropopause, since TAS falls as it gets colder", () => {
  const baseline = level(30, 34000, 480);
  const climbed = level(30, 36000, 480);
  const result = estimateOperationalCost(baseline, climbed, aircraft);
  assert.ok(result.timeDeltaSec > 0, `expected extra time when climbing at constant Mach below tropopause, got ${result.timeDeltaSec}`);
});

test("estimateOperationalCost: throws on mismatched trajectory lengths", () => {
  const baseline = level(10, 36000);
  const counterfactual = level(9, 36000);
  assert.throws(() => estimateOperationalCost(baseline, counterfactual, aircraft));
});
