import type { TrajectoryPoint } from "../models/flight.js";
import { greatCircleInterpolate, haversineMeters } from "../utils/geo.js";

/**
 * Normalize a raw trajectory: sort by time, drop exact duplicates, and flag
 * physically impossible jumps (implied ground speed far beyond any airliner,
 * e.g. a GPS glitch) rather than silently trusting them.
 *
 * This does NOT interpolate - see `resampleForVisualization` for that. The
 * scientific layer should generally operate on the cleaned-but-unresampled
 * trajectory, preserving each point's true `sourceResolutionSec`, so we never
 * imply the system knows the aircraft's position more precisely than the
 * original observations actually support (spec section 10).
 */
export interface TrajectoryCleaningResult {
  points: TrajectoryPoint[];
  droppedDuplicates: number;
  flaggedOutliers: Array<{ index: number; impliedSpeedKts: number }>;
}

const MAX_PLAUSIBLE_GROUND_SPEED_KTS = 700; // comfortably above any airliner's true airspeed

export function cleanTrajectory(raw: TrajectoryPoint[]): TrajectoryCleaningResult {
  const sorted = [...raw].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const points: TrajectoryPoint[] = [];
  let droppedDuplicates = 0;
  const flaggedOutliers: Array<{ index: number; impliedSpeedKts: number }> = [];

  for (const point of sorted) {
    const prev = points[points.length - 1];
    if (prev && prev.timestamp === point.timestamp) {
      droppedDuplicates++;
      continue;
    }
    if (prev) {
      const dtSec = (new Date(point.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;
      if (dtSec > 0) {
        const distM = haversineMeters(prev.latitude, prev.longitude, point.latitude, point.longitude);
        const impliedSpeedKts = (distM / dtSec) * 1.94384; // m/s -> kts
        if (impliedSpeedKts > MAX_PLAUSIBLE_GROUND_SPEED_KTS) {
          flaggedOutliers.push({ index: points.length, impliedSpeedKts });
        }
        prev.sourceResolutionSec = dtSec;
      }
    }
    points.push({ ...point, interpolated: false });
  }

  return { points, droppedDuplicates, flaggedOutliers };
}

/**
 * Produce a densified trajectory suitable for smooth replay animation. This
 * is explicitly a VISUALIZATION concern: interpolated points are tagged
 * `interpolated: true` and must never be fed into a scientific calculation
 * that assumes real observations (spec section 10). Uses spherical
 * (great-circle) interpolation for position and linear interpolation for
 * altitude/speed/heading.
 */
export function resampleForVisualization(
  points: TrajectoryPoint[],
  targetIntervalSec: number,
): TrajectoryPoint[] {
  if (points.length < 2) return points;
  const out: TrajectoryPoint[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    out.push(a);

    const dtSec = (new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) / 1000;
    if (dtSec <= targetIntervalSec) continue;

    const steps = Math.floor(dtSec / targetIntervalSec);
    for (let s = 1; s < steps; s++) {
      const fraction = (s * targetIntervalSec) / dtSec;
      const { latitude, longitude } = greatCircleInterpolate(
        a.latitude,
        a.longitude,
        b.latitude,
        b.longitude,
        fraction,
      );
      out.push({
        timestamp: new Date(new Date(a.timestamp).getTime() + fraction * dtSec * 1000).toISOString(),
        latitude,
        longitude,
        altitudeFt: a.altitudeFt + fraction * (b.altitudeFt - a.altitudeFt),
        groundSpeedKts:
          a.groundSpeedKts !== undefined && b.groundSpeedKts !== undefined
            ? a.groundSpeedKts + fraction * (b.groundSpeedKts - a.groundSpeedKts)
            : undefined,
        heading: a.heading,
        interpolated: true,
      });
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}
