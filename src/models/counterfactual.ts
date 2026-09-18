import type { AnnotatedTrajectoryPoint, TrajectoryPoint } from "./flight.js";

/** A contiguous span of the flight where contrail impact is concentrated. */
export interface CriticalWindow {
  startTimestamp: string;
  endTimestamp: string;
  startIndex: number;
  endIndex: number;
  durationSec: number;
  /** Sum of positive segment energy forcing within the window, Joules. */
  totalPositiveEnergyForcingJ: number;
  /** Fraction of the whole flight's total positive energy forcing this window contains, [0,1]. */
  shareOfFlightImpact: number;
  /** Confidence rollup across samples in the window. */
  confidence: "low" | "medium" | "high";
}

export type CounterfactualStrategyKind =
  | "full-flight-offset"
  | "critical-window-descent"
  | "critical-window-climb"
  | "return-to-cruise"
  | "multi-step-profile";

export interface CounterfactualStrategyParams {
  kind: CounterfactualStrategyKind;
  /** Altitude change in feet. Negative = descend, positive = climb. */
  altitudeOffsetFt: number;
  /** Which critical window (by index into flight's windows array) this targets, if localized. */
  windowIndex?: number;
}

export interface FeasibilityFlags {
  /** False if the requested altitude is outside the aircraft's plausible service ceiling/floor. */
  withinServiceCeiling: boolean;
  /** False if the requested change would require an unrealistic climb/descent rate. */
  withinKinematicLimits: boolean;
  /** Human-readable notes on any approximations or violations. */
  notes: string[];
}

export interface Counterfactual {
  id: string;
  flightId: string;
  strategy: CounterfactualStrategyParams;
  modifiedTrajectory: TrajectoryPoint[];
  /** Altitude in feet at each trajectory index, for quick charting. */
  altitudeProfileFt: number[];
  annotated: AnnotatedTrajectoryPoint[];
  baselineImpactJ: number;
  contrailImpactJ: number;
  /** (baseline - counterfactual) / baseline, as a fraction. Positive = improvement. */
  impactReduction: number;
  estimatedFuelDeltaKg: number;
  estimatedCO2DeltaKg: number;
  estimatedTimeDeltaSec: number;
  uncertainty: {
    level: "low" | "medium" | "high";
    reasons: string[];
  };
  feasibilityFlags: FeasibilityFlags;
}

/** One point on the operational-cost vs. contrail-benefit tradeoff plot. */
export interface TradeoffPoint {
  counterfactualId: string;
  /** x-axis: operational cost, in kg estimated fuel delta (a single scalar proxy). */
  operationalCost: number;
  /** y-axis: contrail benefit, as impactReduction fraction, [0,1] (can be negative if worse). */
  contrailBenefit: number;
  uncertainty: "low" | "medium" | "high";
  strategy: CounterfactualStrategyParams;
  /** True if no other point strictly dominates this one (lower cost AND higher benefit). */
  isNonDominated: boolean;
  isKneePoint: boolean;
}
