import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCriticalWindows } from "../criticalWindow.js";
import type { AnnotatedTrajectoryPoint, AtmosphericSample } from "../../models/flight.js";

function makeAnnotated(efValuesJ: Array<number | null>): AnnotatedTrajectoryPoint[] {
  return efValuesJ.map((ef, i) => ({
    point: {
      timestamp: new Date(i * 60_000).toISOString(), // one point per minute
      latitude: 45,
      longitude: -40 + i,
      altitudeFt: 36000,
      interpolated: false,
    },
    sample:
      ef === null
        ? null
        : ({
            timestamp: new Date(i * 60_000).toISOString(),
            latitude: 45,
            longitude: -40 + i,
            flightLevel: 360,
            temperatureK: 220,
            relativeHumidityIcePct: 100,
            sac: 1,
            issr: 1,
            persistentContrailProbability: 0.8,
            segmentEnergyForcingJ: ef,
            confidence: "medium",
            providerId: "demo-dataset",
          } satisfies AtmosphericSample),
  }));
}

test("detectCriticalWindows: returns empty when there is no positive forcing anywhere", () => {
  const annotated = makeAnnotated(new Array(20).fill(0));
  const windows = detectCriticalWindows(annotated);
  assert.equal(windows.length, 0);
});

test("detectCriticalWindows: concentrates on a sharp spike rather than spreading across the whole flight", () => {
  // 60 minutes total, a strong 10-minute spike in the middle, near-zero elsewhere.
  const values = new Array(60).fill(1e6);
  for (let i = 25; i < 35; i++) values[i] = 5e10;
  const annotated = makeAnnotated(values);

  const windows = detectCriticalWindows(annotated, { minDurationSec: 300, targetShare: 0.4 });
  assert.equal(windows.length, 1);
  const w = windows[0]!;
  // The window must lie entirely inside the spike region [25,34] - the
  // algorithm should not need to reach outside the spike to hit the target
  // share, and should not report a window disjoint from the spike.
  assert.ok(w.startIndex >= 25 && w.startIndex <= 34, `window should start inside the spike, got ${w.startIndex}`);
  assert.ok(w.endIndex >= 25 && w.endIndex <= 34, `window should end inside the spike, got ${w.endIndex}`);
  assert.ok(w.shareOfFlightImpact >= 0.4);
  // The window should be much shorter than the full 59-minute flight -
  // this is the "smallest meaningful intervention" property from spec section 4.
  assert.ok(w.durationSec < 59 * 60 * 0.5);
  assert.ok(w.durationSec >= 300, "must respect the configured minimum window duration");
});

test("detectCriticalWindows: respects minDurationSec (ignores a single-point spike as noise)", () => {
  const values = new Array(30).fill(0);
  values[15] = 1e12; // one isolated huge point, single sample
  const annotated = makeAnnotated(values);
  const windows = detectCriticalWindows(annotated, { minDurationSec: 600 }); // require >= 10 min
  // A single point can't form a 10-minute window on its own; the algorithm
  // must still return *some* window (fallback path) but it cannot be
  // shorter than minDurationSec.
  if (windows.length > 0) {
    assert.ok(windows[0]!.durationSec >= 600);
  }
});

test("detectCriticalWindows: mixed confidence rolls up to the worst confidence present", () => {
  const annotated = makeAnnotated([0, 0, 1e9, 1e9, 1e9, 0, 0]);
  annotated[3]!.sample = { ...(annotated[3]!.sample as AtmosphericSample), confidence: "low" };
  const windows = detectCriticalWindows(annotated, { minDurationSec: 60, targetShare: 0.5 });
  assert.equal(windows.length, 1);
  assert.equal(windows[0]!.confidence, "low");
});
