import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTrajectory, resampleForVisualization } from "../trajectory.js";
import type { TrajectoryPoint } from "../../models/flight.js";

function pt(tsSec: number, lat: number, lon: number, alt: number): TrajectoryPoint {
  return {
    timestamp: new Date(tsSec * 1000).toISOString(),
    latitude: lat,
    longitude: lon,
    altitudeFt: alt,
    interpolated: false,
  };
}

test("cleanTrajectory: sorts out-of-order points by time", () => {
  const raw = [pt(20, 41, -70, 35000), pt(0, 40, -73, 34000), pt(10, 40.5, -71.5, 34500)];
  const { points } = cleanTrajectory(raw);
  assert.deepEqual(
    points.map((p) => p.timestamp),
    [raw[1]!.timestamp, raw[2]!.timestamp, raw[0]!.timestamp],
  );
});

test("cleanTrajectory: drops exact-duplicate timestamps", () => {
  const raw = [pt(0, 40, -73, 34000), pt(0, 40, -73, 34000), pt(10, 40.1, -72.9, 34200)];
  const { points, droppedDuplicates } = cleanTrajectory(raw);
  assert.equal(points.length, 2);
  assert.equal(droppedDuplicates, 1);
});

test("cleanTrajectory: flags physically impossible ground-speed jumps without deleting them", () => {
  // ~2500 nm in 10 seconds is obviously not a real airliner.
  const raw = [pt(0, 40, -73, 34000), pt(10, 51, -0.5, 34000)];
  const { points, flaggedOutliers } = cleanTrajectory(raw);
  assert.equal(points.length, 2, "outliers are flagged, not silently dropped");
  assert.equal(flaggedOutliers.length, 1);
  assert.ok(flaggedOutliers[0]!.impliedSpeedKts > 700);
});

test("cleanTrajectory: records sourceResolutionSec between consecutive real observations", () => {
  const raw = [pt(0, 40, -73, 34000), pt(45, 40.05, -72.9, 34100)];
  const { points } = cleanTrajectory(raw);
  assert.equal(points[0]!.sourceResolutionSec, 45);
});

test("resampleForVisualization: inserted points are tagged interpolated=true, originals are not", () => {
  const raw = [pt(0, 40, -73, 34000), pt(120, 41, -71, 35000)];
  const resampled = resampleForVisualization(raw, 30);
  assert.ok(resampled.length > 2, "should have densified the 120s gap");
  assert.equal(resampled[0]!.interpolated, false);
  assert.equal(resampled[resampled.length - 1]!.interpolated, false);
  const interpolatedCount = resampled.filter((p) => p.interpolated).length;
  assert.ok(interpolatedCount > 0);
});

test("resampleForVisualization: does not alter trajectories already denser than the target interval", () => {
  const raw = [pt(0, 40, -73, 34000), pt(5, 40.01, -72.99, 34010)];
  const resampled = resampleForVisualization(raw, 30);
  assert.equal(resampled.length, 2);
});
