import type { TrajectoryPoint } from "../models/flight.js";
import type { FeasibilityFlags } from "../models/counterfactual.js";

/**
 * Simplified kinematic assumptions for altitude transitions. These are
 * explicitly approximations (spec section 15: "The system can use
 * simplified kinematic assumptions. Explicitly label them as
 * approximations.") - real climb/descent rate depends on weight, thrust
 * setting, air temperature and ATC constraints; we use representative
 * constant rates by phase instead of a full performance model.
 */
export const DEFAULT_KINEMATIC_ASSUMPTIONS = {
  climbRateFtPerMin: 800, // step-climb rate at cruise altitude, conservative
  descentRateFtPerMin: 1500, // cruise-altitude step-descent, conservative
  /** Absolute altitude bounds outside which we refuse to generate a counterfactual. */
  minAltitudeFt: 28000,
  maxAltitudeFt: 43000,
};

export interface AltitudeWindow {
  /** Index into the base trajectory where the hold region begins. */
  startIndex: number;
  /** Index into the base trajectory where the hold region ends. */
  endIndex: number;
  /** Feet, signed: negative = descend, positive = climb. */
  offsetFt: number;
  /** If true, altitude is NOT returned to baseline after endIndex (full-flight-style). */
  permanent: boolean;
}

/**
 * Build a new altitude-per-point array by ramping in before `startIndex`,
 * holding `offsetFt` above/below the original altitude through the window,
 * and (unless `permanent`) ramping back out after `endIndex`. Ramp duration
 * is derived from `offsetFt` and the assumed climb/descent rate, never an
 * instantaneous jump between adjacent samples.
 */
export function applyAltitudeWindow(
  points: TrajectoryPoint[],
  window: AltitudeWindow,
  kinematics = DEFAULT_KINEMATIC_ASSUMPTIONS,
): { altitudes: number[]; feasibility: FeasibilityFlags } {
  const notes: string[] = [];
  const rateFtPerMin =
    window.offsetFt < 0 ? kinematics.descentRateFtPerMin : kinematics.climbRateFtPerMin;
  const transitionSec = (Math.abs(window.offsetFt) / rateFtPerMin) * 60;

  const times = points.map((p) => new Date(p.timestamp).getTime() / 1000);
  const startTime = times[window.startIndex]!;
  const endTime = times[window.endIndex]!;

  const rampInStart = startTime - transitionSec;
  const rampOutEnd = endTime + transitionSec;

  let withinKinematicLimits = true;
  if (rampInStart < times[0]!) {
    withinKinematicLimits = false;
    notes.push(
      "Requested altitude change cannot complete before the critical window begins at the assumed transition rate; ramp is truncated to the start of the available trajectory.",
    );
  }
  if (!window.permanent && rampOutEnd > times[times.length - 1]!) {
    withinKinematicLimits = false;
    notes.push(
      "Requested return-to-cruise cannot complete before the trajectory ends at the assumed transition rate; ramp is truncated to the end of the available trajectory.",
    );
  }

  const altitudes = points.map((point, i) => {
    const base = point.altitudeFt;
    const t = times[i]!;

    if (t < Math.max(rampInStart, times[0]!)) {
      return base;
    }
    if (t >= Math.max(rampInStart, times[0]!) && t < startTime) {
      const denom = startTime - Math.max(rampInStart, times[0]!);
      const fraction = denom > 0 ? (t - Math.max(rampInStart, times[0]!)) / denom : 1;
      return base + fraction * window.offsetFt;
    }
    if (t >= startTime && t <= endTime) {
      return base + window.offsetFt;
    }
    if (window.permanent) {
      return base + window.offsetFt;
    }
    const rampOutEndClamped = Math.min(rampOutEnd, times[times.length - 1]!);
    if (t > endTime && t <= rampOutEndClamped) {
      const denom = rampOutEndClamped - endTime;
      const fraction = denom > 0 ? (t - endTime) / denom : 1;
      return base + (1 - fraction) * window.offsetFt;
    }
    return base;
  });

  // Service ceiling only makes sense to check over the region actually
  // affected by this counterfactual (the ramps + hold). Checking the whole
  // trajectory would trivially "fail" every counterfactual on any flight
  // whose climb-out or approach passes through low altitude, which has
  // nothing to do with the requested cruise-altitude change.
  const rampInStartClamped = Math.max(rampInStart, times[0]!);
  const rampOutEndClamped = window.permanent
    ? times[times.length - 1]!
    : Math.min(rampOutEnd, times[times.length - 1]!);
  const affectedAltitudes = altitudes.filter((_, i) => {
    const t = times[i]!;
    return t >= rampInStartClamped && t <= rampOutEndClamped;
  });
  const minAlt = Math.min(...affectedAltitudes);
  const maxAlt = Math.max(...affectedAltitudes);
  const withinServiceCeiling =
    minAlt >= kinematics.minAltitudeFt && maxAlt <= kinematics.maxAltitudeFt;
  if (!withinServiceCeiling) {
    notes.push(
      `Resulting altitude range [${Math.round(minAlt)}, ${Math.round(maxAlt)}] ft exceeds the assumed service ceiling bounds [${kinematics.minAltitudeFt}, ${kinematics.maxAltitudeFt}] ft for this aircraft class.`,
    );
  }

  return {
    altitudes,
    feasibility: { withinServiceCeiling, withinKinematicLimits, notes },
  };
}

/**
 * Find the index range that represents genuine level cruise flight - not
 * simply "above a floor altitude," which would incorrectly include the tail
 * of the climb (still ascending through, say, 20,000-34,000 ft) as if it
 * were already level cruise. We look for points where the local vertical
 * rate is small (level flight), including step-climb plateaus, and take the
 * envelope from the first to the last such point.
 */
export function findCruiseRange(
  points: TrajectoryPoint[],
  minAltitudeFt = 15000,
  maxVerticalRateFtPerMin = 150,
): { startIndex: number; endIndex: number } | null {
  const rates: number[] = new Array(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    const dtMin = (new Date(points[i]!.timestamp).getTime() - new Date(points[i - 1]!.timestamp).getTime()) / 60000;
    rates[i] = dtMin > 0 ? (points[i]!.altitudeFt - points[i - 1]!.altitudeFt) / dtMin : 0;
  }

  let start = -1;
  let end = -1;
  points.forEach((p, i) => {
    const isLevel = Math.abs(rates[i]!) <= maxVerticalRateFtPerMin;
    if (p.altitudeFt >= minAltitudeFt && isLevel) {
      if (start === -1) start = i;
      end = i;
    }
  });
  if (start === -1) return null;
  return { startIndex: start, endIndex: end };
}
