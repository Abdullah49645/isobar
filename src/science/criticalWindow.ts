import type { AnnotatedTrajectoryPoint } from "../models/flight.js";
import type { CriticalWindow } from "../models/counterfactual.js";

/**
 * Identify the contiguous span(s) of a flight where positive (warming)
 * contrail energy forcing is disproportionately concentrated.
 *
 * Approach: a sliding-window sum over positive segment energy forcing,
 * looking for the shortest window that captures at least `targetShare` of
 * the flight's total positive forcing (default 40%). This deliberately
 * favors *concentration* over *magnitude alone* - a long mediocre stretch
 * won't beat a short, sharp encounter - which is what makes "the smallest
 * meaningful intervention" (spec section 4, step 11) findable at all.
 *
 * We aggregate over segments, not single points, per spec section 12
 * ("Do not simply identify the highest single point"). A single very high
 * waypoint sitting inside a long uneventful stretch is not, by itself, a
 * critical window - windows must have some minimum duration.
 */
export interface CriticalWindowOptions {
  /** Minimum window duration in seconds. Below this, we consider a spike un-actionable noise. */
  minDurationSec?: number;
  /** Maximum window duration as a fraction of total flight duration. */
  maxDurationFraction?: number;
  /** Stop expanding once this share of total positive forcing is captured. */
  targetShare?: number;
}

export function detectCriticalWindows(
  annotated: AnnotatedTrajectoryPoint[],
  options: CriticalWindowOptions = {},
): CriticalWindow[] {
  const minDurationSec = options.minDurationSec ?? 300; // 5 minutes
  const maxDurationFraction = options.maxDurationFraction ?? 0.5;
  const targetShare = options.targetShare ?? 0.4;

  const positiveForcings = annotated.map((a) => {
    const ef = a.sample?.segmentEnergyForcingJ;
    return ef !== null && ef !== undefined && ef > 0 ? ef : 0;
  });
  const totalPositive = positiveForcings.reduce((s, v) => s + v, 0);

  if (totalPositive <= 0 || annotated.length < 2) {
    return [];
  }

  const firstTs = new Date(annotated[0]!.point.timestamp).getTime();
  const lastTs = new Date(annotated[annotated.length - 1]!.point.timestamp).getTime();
  const totalDurationSec = (lastTs - firstTs) / 1000;
  const maxDurationSec = totalDurationSec * maxDurationFraction;

  // Prefix sums for O(1) range-sum queries while searching window candidates.
  const prefix = new Array<number>(positiveForcings.length + 1).fill(0);
  for (let i = 0; i < positiveForcings.length; i++) {
    prefix[i + 1] = prefix[i]! + positiveForcings[i]!;
  }

  const timestamps = annotated.map((a) => new Date(a.point.timestamp).getTime());

  // Find the smallest window (by duration) whose share of total positive
  // forcing meets targetShare, scanning all candidate start points and
  // growing each window only as long as needed. O(n^2) worst case, which is
  // entirely fine at flight-trajectory scale (hundreds to low thousands of
  // points), and keeps the algorithm easy to audit/test.
  let best: { start: number; end: number; sum: number; durationSec: number } | null = null;

  for (let start = 0; start < annotated.length - 1; start++) {
    for (let end = start + 1; end < annotated.length; end++) {
      const durationSec = (timestamps[end]! - timestamps[start]!) / 1000;
      if (durationSec < minDurationSec) continue;
      if (durationSec > maxDurationSec) break;

      const sum = prefix[end + 1]! - prefix[start]!;
      const share = sum / totalPositive;
      if (share < targetShare) continue;

      if (!best || durationSec < best.durationSec || (durationSec === best.durationSec && sum > best.sum)) {
        best = { start, end, sum, durationSec };
      }
      // Once we've met the target share for this start, growing further
      // only increases duration without a required benefit - move on.
      break;
    }
  }

  if (!best) {
    // No single window hit the target share (impact is spread thin) - fall
    // back to reporting the single richest window that clears the minimum
    // duration, so the UI still has something concrete to point at.
    for (let start = 0; start < annotated.length - 1; start++) {
      for (let end = start + 1; end < annotated.length; end++) {
        const durationSec = (timestamps[end]! - timestamps[start]!) / 1000;
        if (durationSec < minDurationSec) continue;
        if (durationSec > maxDurationSec) break;
        const sum = prefix[end + 1]! - prefix[start]!;
        if (!best || sum > best.sum) {
          best = { start, end, sum, durationSec };
        }
      }
    }
  }

  if (!best) return [];

  const windowConfidences = annotated
    .slice(best.start, best.end + 1)
    .map((a) => a.sample?.confidence ?? "low");
  const confidence: CriticalWindow["confidence"] = windowConfidences.includes("low")
    ? "low"
    : windowConfidences.includes("medium")
      ? "medium"
      : "high";

  return [
    {
      startTimestamp: annotated[best.start]!.point.timestamp,
      endTimestamp: annotated[best.end]!.point.timestamp,
      startIndex: best.start,
      endIndex: best.end,
      durationSec: best.durationSec,
      totalPositiveEnergyForcingJ: best.sum,
      shareOfFlightImpact: best.sum / totalPositive,
      confidence,
    },
  ];
}
