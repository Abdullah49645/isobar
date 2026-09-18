import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTradeoffPoints } from "../pareto.js";
import type { Counterfactual } from "../../models/counterfactual.js";

let counter = 0;
function fixture(fuelDeltaKg: number, impactReduction: number): Counterfactual {
  counter++;
  return {
    id: `cf-${counter}`,
    flightId: "flight-1",
    strategy: { kind: "critical-window-descent", altitudeOffsetFt: -2000, windowIndex: 0 },
    modifiedTrajectory: [],
    altitudeProfileFt: [],
    annotated: [],
    baselineImpactJ: 1e11,
    contrailImpactJ: 1e11 * (1 - impactReduction),
    impactReduction,
    estimatedFuelDeltaKg: fuelDeltaKg,
    estimatedCO2DeltaKg: fuelDeltaKg * 3.16,
    estimatedTimeDeltaSec: 60,
    uncertainty: { level: "medium", reasons: [] },
    feasibilityFlags: { withinServiceCeiling: true, withinKinematicLimits: true, notes: [] },
  };
}

test("buildTradeoffPoints: a point dominated on both axes is marked non-dominated=false", () => {
  const cheap = fixture(10, 0.6); // low cost, high benefit
  const expensiveWorse = fixture(50, 0.3); // high cost, low benefit - dominated by `cheap`
  const points = buildTradeoffPoints([cheap, expensiveWorse]);
  const cheapPoint = points.find((p) => p.counterfactualId === cheap.id)!;
  const dominatedPoint = points.find((p) => p.counterfactualId === expensiveWorse.id)!;
  assert.equal(cheapPoint.isNonDominated, true);
  assert.equal(dominatedPoint.isNonDominated, false);
});

test("buildTradeoffPoints: points on the efficient frontier (cheaper OR better) are all non-dominated", () => {
  const a = fixture(5, 0.2);
  const b = fixture(20, 0.5);
  const c = fixture(50, 0.7);
  const points = buildTradeoffPoints([a, b, c]);
  assert.ok(points.every((p) => p.isNonDominated));
});

test("buildTradeoffPoints: exactly one knee point is marked among the frontier", () => {
  const a = fixture(2, 0.1); // cheap, small benefit
  const b = fixture(10, 0.65); // moderate cost, big benefit jump - the likely knee
  const points = buildTradeoffPoints([a, b, fixture(60, 0.7)]);
  const kneeCount = points.filter((p) => p.isKneePoint).length;
  assert.equal(kneeCount, 1);
});

test("buildTradeoffPoints: a near-free tiny-benefit option does not win the knee over a clearly better mid-cost one", () => {
  // Note: the true zero-cost/zero-benefit baseline is the ACTUAL flight, not
  // a counterfactual - it never appears in this list (spec section 21: the
  // baseline is highlighted separately from the counterfactual alternatives).
  const almostNothing = fixture(1, 0.02);
  const good = fixture(15, 0.5);
  const expensive = fixture(60, 0.7);
  const points = buildTradeoffPoints([almostNothing, good, expensive]);
  const kneePoint = points.find((p) => p.isKneePoint);
  assert.equal(kneePoint?.counterfactualId, good.id);
});

test("buildTradeoffPoints: single counterfactual is trivially both non-dominated and the knee", () => {
  const only = fixture(20, 0.4);
  const points = buildTradeoffPoints([only]);
  assert.equal(points.length, 1);
  assert.equal(points[0]!.isNonDominated, true);
  assert.equal(points[0]!.isKneePoint, true);
});
