import type { AnnotatedTrajectoryPoint } from "../models/flight.js";

/** Sum of segment energy forcing across a trajectory (can be negative = net cooling). */
export function totalEnergyForcingJ(annotated: AnnotatedTrajectoryPoint[]): number {
  return annotated.reduce((sum, a) => {
    const ef = a.sample?.segmentEnergyForcingJ;
    return sum + (ef ?? 0);
  }, 0);
}

/** Overall confidence rollup: "low" if any sample is low, else worst present. */
export function rollupConfidence(
  annotated: AnnotatedTrajectoryPoint[],
): "low" | "medium" | "high" {
  const seen = new Set(annotated.map((a) => a.sample?.confidence ?? "low"));
  if (seen.has("low")) return "low";
  if (seen.has("medium")) return "medium";
  return "high";
}

/** Fraction of samples for which no atmospheric data was available at all. */
export function missingDataFraction(annotated: AnnotatedTrajectoryPoint[]): number {
  if (annotated.length === 0) return 0;
  const missing = annotated.filter((a) => a.sample === null).length;
  return missing / annotated.length;
}
