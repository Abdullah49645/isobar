/**
 * Precompute demo flight data.
 *
 * This does double duty:
 *  1. VALIDATION (spec section 63, Phase 1: "Validate coordinate/time/
 *     altitude alignment") - running the full pipeline here, with console
 *     output of the key numbers, is how we sanity-check the science engine
 *     against physically-plausible magnitudes before any UI exists.
 *  2. PRECOMPUTE (spec sections 7, 38, 52) - writes a lightweight flight
 *     index (for the landing screen's flight cards) and the baseline
 *     annotated trajectory (for the "actual" replay) to demo-data/flights/.
 *     Full counterfactual generation is fast, deterministic, synthetic-data
 *     math (not a real network call), so the frontend runs the same
 *     analyzeFlight() pipeline live in-browser for interactive "WHAT IF?"
 *     exploration rather than shipping every possible counterfactual as a
 *     giant static blob - see src/science/pipeline.ts. This script writes a
 *     fully precomputed analysis (including every standard counterfactual)
 *     only for the primary demo flight, as the "verified demo dataset"
 *     fallback referenced in spec section 41's failure-state guidance.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { analyzeFlight, type FlightAnalysis } from "../src/science/pipeline.js";
import { DemoDatasetProvider } from "../src/data/providers/demoDatasetProvider.js";
import {
  buildDemoFlightBosDub,
  buildDemoFlightJfkLhr,
  buildDemoFlightJfkLhrClearSkies,
} from "../src/data/demoFlights.js";
import type { Flight } from "../src/models/flight.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "demo-data", "flights");
mkdirSync(OUT_DIR, { recursive: true });

function fmtJ(j: number): string {
  const tj = j / 1e12;
  return `${tj.toFixed(3)} TJ`;
}

function summarizeAnalysis(analysis: FlightAnalysis) {
  const { flight, baselineTotalImpactJ, criticalWindows, counterfactuals, tradeoffPoints } = analysis;

  console.log(`\n=== ${flight.callsign} (${flight.origin} -> ${flight.destination}, ${flight.aircraft.displayName}) ===`);
  console.log(`  Waypoints: ${flight.trajectory.length}`);
  console.log(`  Baseline total energy forcing: ${fmtJ(baselineTotalImpactJ)}`);
  console.log(`  Critical windows found: ${criticalWindows.length}`);
  for (const w of criticalWindows) {
    console.log(
      `    - ${w.startTimestamp} -> ${w.endTimestamp} (${Math.round(w.durationSec / 60)} min), ` +
        `${(w.shareOfFlightImpact * 100).toFixed(1)}% of flight impact, confidence=${w.confidence}`,
    );
  }
  console.log(`  Counterfactuals generated: ${counterfactuals.length}`);
  const knee = tradeoffPoints.find((p) => p.isKneePoint);
  if (knee) {
    const cf = counterfactuals.find((c) => c.id === knee.counterfactualId)!;
    console.log(
      `  Knee (high-leverage) option: ${cf.strategy.kind} ${cf.strategy.altitudeOffsetFt}ft -> ` +
        `${(cf.impactReduction * 100).toFixed(1)}% impact reduction, ` +
        `${cf.estimatedFuelDeltaKg.toFixed(1)}kg fuel, ${cf.estimatedCO2DeltaKg.toFixed(1)}kg CO2, ` +
        `${(cf.estimatedTimeDeltaSec / 60).toFixed(1)}min time delta`,
    );
  }
  const nonDominatedCount = tradeoffPoints.filter((p) => p.isNonDominated).length;
  console.log(`  Non-dominated (Pareto frontier) alternatives: ${nonDominatedCount} / ${tradeoffPoints.length}`);

  const infeasible = counterfactuals.filter(
    (c) => !c.feasibilityFlags.withinServiceCeiling || !c.feasibilityFlags.withinKinematicLimits,
  );
  if (infeasible.length > 0) {
    console.log(`  Flagged-infeasible counterfactuals: ${infeasible.length}`);
  }
}

/** Slim per-flight summary for the landing screen's flight-selection cards (spec section 30). */
function buildCardSummary(analysis: FlightAnalysis) {
  const { flight, criticalWindows, baselineTotalImpactJ } = analysis;
  const durationMin = Math.round(
    (new Date(flight.arrivalTime).getTime() - new Date(flight.departureTime).getTime()) / 60000,
  );
  const sensitivity: "high" | "low" | "moderate" =
    criticalWindows.length === 0 || Math.abs(baselineTotalImpactJ) < 5e11
      ? "low"
      : criticalWindows[0]!.shareOfFlightImpact > 0.5
        ? "high"
        : "moderate";

  return {
    id: flight.id,
    callsign: flight.callsign,
    origin: flight.origin,
    destination: flight.destination,
    aircraft: flight.aircraft.displayName,
    durationMin,
    contrailSensitivity: sensitivity,
    baselineTotalImpactJ,
    hasCriticalWindow: criticalWindows.length > 0,
    dataProvenance: flight.dataProvenance,
  };
}

async function run() {
  const flights: Flight[] = [buildDemoFlightJfkLhr(), buildDemoFlightJfkLhrClearSkies(), buildDemoFlightBosDub()];

  const cardSummaries: ReturnType<typeof buildCardSummary>[] = [];

  for (const flight of flights) {
    const provider = new DemoDatasetProvider(flight.departureTime);
    const analysis = await analyzeFlight(flight, provider);
    summarizeAnalysis(analysis);
    cardSummaries.push(buildCardSummary(analysis));

    // Baseline (actual) annotated trajectory - always written, used for the
    // "actual" replay and risk-coloring regardless of which flight is primary.
    writeFileSync(
      join(OUT_DIR, `${flight.id}-baseline.json`),
      JSON.stringify(
        {
          flight: analysis.flight,
          baselineAnnotated: analysis.baselineAnnotated,
          baselineTotalImpactJ: analysis.baselineTotalImpactJ,
          criticalWindows: analysis.criticalWindows,
        },
        null,
        2,
      ),
    );

    // Full precomputed analysis - every counterfactual + Pareto frontier -
    // only for the primary demo flight, as the guaranteed-working fallback
    // referenced in spec section 41. We drop each counterfactual's full
    // per-waypoint `annotated` array here: it's fully re-derivable from the
    // deterministic engine (same flight + same strategy always reproduces
    // the same numbers - see the determinism test in
    // src/science/__tests__/pipeline.test.ts) and re-including it bloated
    // this file from ~350KB to >7MB for no benefit to a fallback that only
    // needs to answer "what were the headline numbers," not re-render a
    // full replay.
    if (flight.id === "demo-jfk-lhr-b789") {
      const slim = {
        ...analysis,
        counterfactuals: analysis.counterfactuals.map(({ annotated: _annotated, ...rest }) => rest),
      };
      writeFileSync(join(OUT_DIR, `${flight.id}-full-analysis.json`), JSON.stringify(slim, null, 2));
    }
  }

  writeFileSync(join(OUT_DIR, "index.json"), JSON.stringify({ flights: cardSummaries }, null, 2));
  console.log(`\nWrote flight index + baseline trajectories to ${OUT_DIR}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
