import type { AircraftModel, AnnotatedTrajectoryPoint, TrajectoryPoint } from "../models/flight.js";
import type {
  Counterfactual,
  CounterfactualStrategyParams,
  CriticalWindow,
} from "../models/counterfactual.js";
import type { ContrailProvider } from "../data/contrailProvider.js";
import {
  applyAltitudeWindow,
  findCruiseRange,
  DEFAULT_KINEMATIC_ASSUMPTIONS,
  type AltitudeWindow,
} from "./altitudeProfile.js";
import { estimateOperationalCost } from "./operationalCost.js";
import { missingDataFraction, rollupConfidence, totalEnergyForcingJ } from "../science/impact.js";

function windowSpecFor(
  baseline: TrajectoryPoint[],
  strategy: CounterfactualStrategyParams,
  criticalWindows: CriticalWindow[],
): AltitudeWindow {
  const { kind, altitudeOffsetFt, windowIndex } = strategy;

  if (kind === "full-flight-offset") {
    const cruise = findCruiseRange(baseline);
    if (!cruise) {
      throw new Error("Cannot apply a full-flight offset: no cruise-altitude segment found.");
    }
    return { startIndex: cruise.startIndex, endIndex: cruise.endIndex, offsetFt: altitudeOffsetFt, permanent: false };
  }

  const cw = criticalWindows[windowIndex ?? 0];
  if (!cw) {
    throw new Error("Localized strategy requires a valid critical window index.");
  }

  switch (kind) {
    case "critical-window-descent":
      return { startIndex: cw.startIndex, endIndex: cw.endIndex, offsetFt: -Math.abs(altitudeOffsetFt), permanent: false };
    case "critical-window-climb":
      return { startIndex: cw.startIndex, endIndex: cw.endIndex, offsetFt: Math.abs(altitudeOffsetFt), permanent: false };
    case "return-to-cruise": {
      // Conservative avoidance: extend the hold region with margin on both
      // sides of the critical window, then explicitly return to the
      // original cruise altitude afterward (spec section 14, Strategy D).
      const marginIndices = Math.max(2, Math.round((cw.endIndex - cw.startIndex) * 0.5));
      const startIndex = Math.max(0, cw.startIndex - marginIndices);
      const endIndex = Math.min(baseline.length - 1, cw.endIndex + marginIndices);
      return { startIndex, endIndex, offsetFt: altitudeOffsetFt, permanent: false };
    }
    case "multi-step-profile": {
      // Two-stage: this function returns the deeper second stage; the first,
      // shallower stage is layered on by the caller (see generateCounterfactual).
      return { startIndex: cw.startIndex, endIndex: cw.endIndex, offsetFt: altitudeOffsetFt, permanent: false };
    }
    default:
      throw new Error(`Unhandled strategy kind: ${kind satisfies never}`);
  }
}

export interface GenerateCounterfactualOptions {
  idPrefix?: string;
}

export async function generateCounterfactual(
  flightId: string,
  baselineAnnotated: AnnotatedTrajectoryPoint[],
  aircraft: AircraftModel,
  strategy: CounterfactualStrategyParams,
  criticalWindows: CriticalWindow[],
  provider: ContrailProvider,
  options: GenerateCounterfactualOptions = {},
): Promise<Counterfactual> {
  const baseline = baselineAnnotated.map((a) => a.point);
  const spec = windowSpecFor(baseline, strategy, criticalWindows);

  let altitudes: number[];
  let feasibility;

  if (strategy.kind === "multi-step-profile") {
    // Stage 1: a shallower offset with wider margin (the "step" out).
    const stage1 = applyAltitudeWindow(
      baseline,
      { ...spec, offsetFt: spec.offsetFt / 2 },
      DEFAULT_KINEMATIC_ASSUMPTIONS,
    );
    // Stage 2: apply the full offset only across the critical window itself,
    // on top of stage 1's altered baseline.
    const stage1Trajectory = baseline.map((p, i) => ({ ...p, altitudeFt: stage1.altitudes[i]! }));
    const stage2 = applyAltitudeWindow(stage1Trajectory, spec, DEFAULT_KINEMATIC_ASSUMPTIONS);
    altitudes = stage2.altitudes;
    feasibility = {
      withinServiceCeiling: stage1.feasibility.withinServiceCeiling && stage2.feasibility.withinServiceCeiling,
      withinKinematicLimits: stage1.feasibility.withinKinematicLimits && stage2.feasibility.withinKinematicLimits,
      notes: [...stage1.feasibility.notes, ...stage2.feasibility.notes],
    };
  } else {
    const result = applyAltitudeWindow(baseline, spec, DEFAULT_KINEMATIC_ASSUMPTIONS);
    altitudes = result.altitudes;
    feasibility = result.feasibility;
  }

  const modifiedTrajectory: TrajectoryPoint[] = baseline.map((p, i) => ({
    ...p,
    altitudeFt: altitudes[i]!,
    interpolated: false,
  }));

  if (!feasibility.withinServiceCeiling || !feasibility.withinKinematicLimits) {
    // We still return a result (so the UI can explain *why* it's infeasible
    // per spec section 41), but callers should surface feasibility.notes
    // prominently rather than presenting the metrics as a clean success.
  }

  const samples = await provider.sampleTrajectory(modifiedTrajectory);
  const annotated: AnnotatedTrajectoryPoint[] = modifiedTrajectory.map((point, i) => ({
    point,
    sample: samples[i] ?? null,
  }));

  const baselineImpactJ = totalEnergyForcingJ(baselineAnnotated);
  const contrailImpactJ = totalEnergyForcingJ(annotated);
  const impactReduction = baselineImpactJ !== 0 ? (baselineImpactJ - contrailImpactJ) / Math.abs(baselineImpactJ) : 0;

  const cost = estimateOperationalCost(baseline, modifiedTrajectory, aircraft);

  const missingFraction = Math.max(missingDataFraction(baselineAnnotated), missingDataFraction(annotated));
  const confidenceReasons: string[] = [
    "Atmospheric field is a synthetic demo approximation, not a live weather model run (see demo-data/README.md).",
    "Fuel/time deltas use a simplified operational model (see src/simulation/operationalCost.ts).",
    "Trajectory interpolation resolution follows the original observation cadence.",
  ];
  if (missingFraction > 0) {
    confidenceReasons.push(`${Math.round(missingFraction * 100)}% of waypoints had no atmospheric sample available.`);
  }
  const uncertaintyLevel: "low" | "medium" | "high" =
    missingFraction > 0.1 || rollupConfidence(annotated) === "low" ? "high" : rollupConfidence(annotated) === "medium" ? "medium" : "low";

  return {
    id: `${options.idPrefix ?? "cf"}-${strategy.kind}-${strategy.altitudeOffsetFt}-${Date.now()}`,
    flightId,
    strategy,
    modifiedTrajectory,
    altitudeProfileFt: altitudes,
    annotated,
    baselineImpactJ,
    contrailImpactJ,
    impactReduction,
    estimatedFuelDeltaKg: cost.fuelDeltaKg,
    estimatedCO2DeltaKg: cost.co2DeltaKg,
    estimatedTimeDeltaSec: cost.timeDeltaSec,
    uncertainty: { level: uncertaintyLevel, reasons: confidenceReasons },
    feasibilityFlags: feasibility,
  };
}
