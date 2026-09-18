import type { Flight, AnnotatedTrajectoryPoint } from "../models/flight.js";
import type { Counterfactual, CounterfactualStrategyParams, CriticalWindow, TradeoffPoint } from "../models/counterfactual.js";
import type { ContrailProvider } from "../data/contrailProvider.js";
import { cleanTrajectory } from "../science/trajectory.js";
import { detectCriticalWindows } from "../science/criticalWindow.js";
import { totalEnergyForcingJ } from "../science/impact.js";
import { buildTradeoffPoints } from "../science/pareto.js";
import { generateCounterfactual } from "../simulation/counterfactualEngine.js";

/**
 * The full "PHASE 1-5" pipeline from the spec's development-order section
 * (section 63): data -> science engine -> counterfactual -> operational
 * model -> Pareto, run end-to-end for one flight. This is what both the
 * precompute script (scripts/precompute-demo-flights.ts) and, later, the
 * live "RUN COUNTERFACTUAL" UI action call.
 */
export interface FlightAnalysis {
  flight: Flight;
  baselineAnnotated: AnnotatedTrajectoryPoint[];
  baselineTotalImpactJ: number;
  criticalWindows: CriticalWindow[];
  counterfactuals: Counterfactual[];
  tradeoffPoints: TradeoffPoint[];
}

/** The standard set of counterfactual alternatives generated for every demo flight (spec section 21: "Generate many counterfactual alternatives"). */
function standardStrategySet(windowIndex: number): CounterfactualStrategyParams[] {
  const offsets = [-4000, -2000, -1000, 1000, 2000, 4000];
  const strategies: CounterfactualStrategyParams[] = [];

  for (const offsetFt of offsets) {
    strategies.push({ kind: "full-flight-offset", altitudeOffsetFt: offsetFt });
    strategies.push({
      kind: offsetFt < 0 ? "critical-window-descent" : "critical-window-climb",
      altitudeOffsetFt: offsetFt,
      windowIndex,
    });
  }
  strategies.push({ kind: "return-to-cruise", altitudeOffsetFt: -2000, windowIndex });
  strategies.push({ kind: "return-to-cruise", altitudeOffsetFt: -4000, windowIndex });
  strategies.push({ kind: "multi-step-profile", altitudeOffsetFt: -4000, windowIndex });

  return strategies;
}

export async function analyzeFlight(
  flight: Flight,
  provider: ContrailProvider,
): Promise<FlightAnalysis> {
  // --- PHASE 1/2: trajectory normalization + atmospheric sampling ---
  const { points: cleanedPoints } = cleanTrajectory(flight.trajectory);
  const samples = await provider.sampleTrajectory(cleanedPoints);
  const baselineAnnotated: AnnotatedTrajectoryPoint[] = cleanedPoints.map((point, i) => ({
    point,
    sample: samples[i] ?? null,
  }));
  const baselineTotalImpactJ = totalEnergyForcingJ(baselineAnnotated);

  // --- Critical window detection ---
  const criticalWindows = detectCriticalWindows(baselineAnnotated);

  // --- PHASE 3/4: counterfactual generation + operational cost ---
  const counterfactuals: Counterfactual[] = [];
  if (criticalWindows.length > 0) {
    const strategies = standardStrategySet(0);
    for (const strategy of strategies) {
      try {
        const cf = await generateCounterfactual(
          flight.id,
          baselineAnnotated,
          flight.aircraft,
          strategy,
          criticalWindows,
          provider,
          { idPrefix: flight.id },
        );
        counterfactuals.push(cf);
      } catch (err) {
        // A strategy can legitimately be infeasible (e.g. exceeds service
        // ceiling) - skip it rather than fail the whole analysis, per spec
        // section 41's failure-state guidance.
        // eslint-disable-next-line no-console
        console.warn(`Skipping infeasible strategy ${strategy.kind}/${strategy.altitudeOffsetFt}ft: ${(err as Error).message}`);
      }
    }
  }

  // --- PHASE 5: Pareto analysis ---
  const tradeoffPoints = buildTradeoffPoints(counterfactuals);

  return {
    flight: { ...flight, trajectory: cleanedPoints },
    baselineAnnotated,
    baselineTotalImpactJ,
    criticalWindows,
    counterfactuals,
    tradeoffPoints,
  };
}
