/* ==========================================================================
   ISOBAR — synthetic satellite observation layer (spec section 32/33)
   ==========================================================================
   HONESTY NOTE (read before touching this file): this build environment has
   no network access to any real satellite-derived contrail product (Google's
   geostationary-satellite detections included). There is no live data here.
   This module generates a clearly-labeled, deterministic, illustrative
   "observation" signal — same spirit as src/science/atmosphericField.ts's
   synthetic-but-documented approach — so the UI can demonstrate the
   MODEL vs. OBSERVATION distinction the spec asks for, without ever
   claiming it's real imagery or attributing a detection to the aircraft.
   Every surface that shows this layer is labeled "synthetic".
   ========================================================================== */
(function () {
  "use strict";

  // Same FNV-1a-style avalanche as src/utils/geo.ts:hashNoise, reimplemented
  // here (not shared with the engine bundle) because this is presentation-
  // layer illustration, not a science-engine calculation.
  function hashNoise() {
    let h = 2166136261;
    for (let i = 0; i < arguments.length; i++) {
      const bits = Math.floor(arguments[i] * 1000);
      h ^= bits;
      h = Math.imul(h, 16777619);
    }
    h ^= h >>> 15;
    return ((h >>> 0) % 100000) / 100000;
  }

  /**
   * For each baseline trajectory index, decide whether a synthetic
   * "satellite" would have reported a detection there. Deliberately NOT a
   * 1:1 copy of the model's persistentContrailProbability — real satellite
   * detection and a physical model agree often but not always, and showing
   * perfect agreement here would misrepresent that relationship.
   */
  function computeDetections(analysis) {
    const annotated = analysis.baselineAnnotated;
    return annotated.map((a, i) => {
      const s = a.sample;
      if (!s || s.persistentContrailProbability === null) return { index: i, observed: false };
      const detectionChance = 0.15 + 0.6 * s.persistentContrailProbability;
      const roll = hashNoise(a.point.latitude * 100, a.point.longitude * 100, i, 7.13);
      return { index: i, observed: roll < detectionChance, modelProbability: s.persistentContrailProbability };
    });
  }

  window.SatelliteLayer = { computeDetections };
})();
