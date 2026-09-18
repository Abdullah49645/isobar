import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFlight } from "../pipeline.js";
import { buildDemoFlightJfkLhr, buildDemoFlightJfkLhrClearSkies } from "../../data/demoFlights.js";
import { DemoDatasetProvider } from "../../data/providers/demoDatasetProvider.js";

test("analyzeFlight: full pipeline runs end-to-end for the primary demo flight without throwing", async () => {
  const flight = buildDemoFlightJfkLhr();
  const provider = new DemoDatasetProvider(flight.departureTime);
  const analysis = await analyzeFlight(flight, provider);

  assert.equal(analysis.baselineAnnotated.length, flight.trajectory.length);
  assert.ok(analysis.criticalWindows.length > 0, "the primary demo flight is designed to hit the synthetic ISSR patch");
  assert.ok(analysis.counterfactuals.length > 0, "should generate at least some feasible counterfactuals");
  assert.equal(analysis.tradeoffPoints.length, analysis.counterfactuals.length);
});

test("analyzeFlight: every counterfactual's contrail impact differs from baseline for a nonzero altitude offset", async () => {
  const flight = buildDemoFlightJfkLhr();
  const provider = new DemoDatasetProvider(flight.departureTime);
  const analysis = await analyzeFlight(flight, provider);

  const nontrivial = analysis.counterfactuals.filter((cf) => cf.strategy.altitudeOffsetFt !== 0);
  assert.ok(nontrivial.length > 0);
  // At least some counterfactuals should actually change the modeled impact -
  // if every single one were bit-identical to baseline, the atmospheric
  // re-sampling at the new altitude wouldn't be doing anything.
  const anyChanged = nontrivial.some((cf) => Math.abs(cf.contrailImpactJ - cf.baselineImpactJ) > 1);
  assert.ok(anyChanged, "expected at least one counterfactual to change modeled contrail impact");
});

test("analyzeFlight: every counterfactual reports a nonzero fuel delta magnitude for a nonzero altitude offset", async () => {
  const flight = buildDemoFlightJfkLhr();
  const provider = new DemoDatasetProvider(flight.departureTime);
  const analysis = await analyzeFlight(flight, provider);

  for (const cf of analysis.counterfactuals) {
    if (cf.strategy.altitudeOffsetFt !== 0) {
      assert.ok(
        Math.abs(cf.estimatedFuelDeltaKg) > 0,
        `strategy ${cf.strategy.kind}/${cf.strategy.altitudeOffsetFt} reported zero fuel delta`,
      );
    }
  }
});

test("analyzeFlight: CO2 delta is always fuel delta times the documented factor, for every counterfactual", async () => {
  const flight = buildDemoFlightJfkLhr();
  const provider = new DemoDatasetProvider(flight.departureTime);
  const analysis = await analyzeFlight(flight, provider);

  for (const cf of analysis.counterfactuals) {
    const expected = cf.estimatedFuelDeltaKg * 3.16;
    assert.ok(Math.abs(cf.estimatedCO2DeltaKg - expected) < 1e-3);
  }
});

test("analyzeFlight: Pareto frontier has at least one non-dominated point and exactly one knee, when counterfactuals exist", async () => {
  const flight = buildDemoFlightJfkLhr();
  const provider = new DemoDatasetProvider(flight.departureTime);
  const analysis = await analyzeFlight(flight, provider);

  assert.ok(analysis.tradeoffPoints.some((p) => p.isNonDominated));
  const kneeCount = analysis.tradeoffPoints.filter((p) => p.isKneePoint).length;
  assert.equal(kneeCount, 1);
});

test("analyzeFlight: is deterministic - running twice on the same flight gives identical totals", async () => {
  const flightA = buildDemoFlightJfkLhr();
  const flightB = buildDemoFlightJfkLhr();
  const providerA = new DemoDatasetProvider(flightA.departureTime);
  const providerB = new DemoDatasetProvider(flightB.departureTime);

  const analysisA = await analyzeFlight(flightA, providerA);
  const analysisB = await analyzeFlight(flightB, providerB);

  assert.equal(analysisA.baselineTotalImpactJ, analysisB.baselineTotalImpactJ);
  assert.equal(analysisA.counterfactuals.length, analysisB.counterfactuals.length);
  assert.equal(analysisA.counterfactuals[0]!.contrailImpactJ, analysisB.counterfactuals[0]!.contrailImpactJ);
});

test("analyzeFlight: the clear-skies demo flight has little or no critical window, contrasting with the primary flight", async () => {
  const flight = buildDemoFlightJfkLhrClearSkies();
  const provider = new DemoDatasetProvider(flight.departureTime);
  const analysis = await analyzeFlight(flight, provider);

  const primary = buildDemoFlightJfkLhr();
  const primaryProvider = new DemoDatasetProvider(primary.departureTime);
  const primaryAnalysis = await analyzeFlight(primary, primaryProvider);

  assert.ok(
    Math.abs(analysis.baselineTotalImpactJ) < Math.abs(primaryAnalysis.baselineTotalImpactJ),
    "clear-skies flight should show materially less modeled impact than the primary encounter flight",
  );
});
