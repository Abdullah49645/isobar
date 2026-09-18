/* ==========================================================================
   ISOBAR — pure logic module
   Every function here is a pure function of its arguments: no DOM access,
   no globals, no state. This is what makes ui/src/__tests__/logic.test.js
   possible without a browser — see that file for the actual UI-layer tests.
   Loaded as a plain <script> in the browser (attaches window.IsobarLogic)
   and required as a CommonJS-ish module under Node for tests.
   ========================================================================== */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = mod;
  }
  root.IsobarLogic = mod;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Formatters
  // ---------------------------------------------------------------------
  const fmt = {
    tj: (j) => (j / 1e12).toFixed(3) + " TJ",
    pct: (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%",
    pct0: (x) => (x * 100).toFixed(0) + "%",
    kg: (x) => (Math.abs(x) >= 1000 ? (x / 1000).toFixed(2) + " t" : x.toFixed(1) + " kg"),
    min: (sec) => {
      const m = sec / 60;
      return (m >= 0 ? "+" : "") + m.toFixed(1) + " min";
    },
    ft: (x) => (x >= 0 ? "+" : "") + x.toLocaleString() + " ft",
    clock: (iso) => new Date(iso).toISOString().slice(11, 16) + "z",
    date: (iso) => new Date(iso).toISOString().slice(0, 10),
  };

  // ---------------------------------------------------------------------
  // Flight-card sensitivity classification (landing screen badges)
  // ---------------------------------------------------------------------
  function sensitivityFromAnalysis(a) {
    if (!a.criticalWindows.length || a.baselineTotalImpactJ <= 0) return "low";
    const share = a.criticalWindows[0].shareOfFlightImpact;
    if (a.baselineTotalImpactJ / 1e12 > 400 || share > 0.4) return "high";
    return a.baselineTotalImpactJ > 0 ? "moderate" : "low";
  }

  // ---------------------------------------------------------------------
  // 2D equirectangular-ish local projection (radar scope)
  // ---------------------------------------------------------------------
  function buildProjection(traj) {
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    traj.forEach((p) => {
      minLat = Math.min(minLat, p.latitude);
      maxLat = Math.max(maxLat, p.latitude);
      minLon = Math.min(minLon, p.longitude);
      maxLon = Math.max(maxLon, p.longitude);
    });
    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    const cosLat = Math.cos((centerLat * Math.PI) / 180);
    return { minLat, maxLat, minLon, maxLon, centerLat, centerLon, cosLat, w: 800, h: 420 };
  }

  function project(proj, lat, lon) {
    const pad = 64;
    const spanX = Math.max((proj.maxLon - proj.minLon) * proj.cosLat, 0.01);
    const spanY = Math.max(proj.maxLat - proj.minLat, 0.01);
    const scale = Math.min((proj.w - pad * 2) / spanX, (proj.h - pad * 2) / spanY);
    const x = proj.w / 2 + (lon - proj.centerLon) * proj.cosLat * scale;
    const y = proj.h / 2 - (lat - proj.centerLat) * scale;
    return { x, y };
  }

  // lat/lon/alt -> unit-sphere-ish xyz for the 3D globe (radius in scene units)
  function latLonAltToXYZ(lat, lon, altFt, radius, altScale) {
    const r = radius + (altFt || 0) * (altScale || 0);
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    return {
      x: -r * Math.sin(phi) * Math.cos(theta),
      z: r * Math.sin(phi) * Math.sin(theta),
      y: r * Math.cos(phi),
    };
  }

  // ---------------------------------------------------------------------
  // Risk color mapping (route coloring + satellite layer)
  // ---------------------------------------------------------------------
  function riskColor(sample, alpha) {
    alpha = alpha === undefined ? 1 : alpha;
    if (!sample || sample.segmentEnergyForcingJ === null) return `rgba(110,130,150,${0.5 * alpha})`;
    if (sample.segmentEnergyForcingJ <= 0) return `rgba(111,184,255,${0.65 * alpha})`;
    const mag = Math.log10(Math.max(sample.segmentEnergyForcingJ, 1e9));
    const t = Math.max(0, Math.min(1, (mag - 10) / 5));
    const r = 242 + t * 13, g = 161 - t * 100, b = 84 - t * 60;
    return `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
  }

  // ---------------------------------------------------------------------
  // What-If builder matching
  // ---------------------------------------------------------------------
  function findMatchingCounterfactual(counterfactuals, mode, offsetFt, specialId) {
    if (specialId) return counterfactuals.find((c) => c.id === specialId) || null;
    if (offsetFt === null || offsetFt === undefined || offsetFt === 0) return null;
    const wantKind = mode === "full" ? "full-flight-offset" : offsetFt < 0 ? "critical-window-descent" : "critical-window-climb";
    return counterfactuals.find((c) => c.strategy.kind === wantKind && c.strategy.altitudeOffsetFt === offsetFt) || null;
  }

  function isOffsetAvailable(counterfactuals, mode, offsetFt) {
    const wantKind = mode === "full" ? "full-flight-offset" : offsetFt < 0 ? "critical-window-descent" : "critical-window-climb";
    return counterfactuals.some((c) => c.strategy.kind === wantKind && c.strategy.altitudeOffsetFt === offsetFt);
  }

  // ---------------------------------------------------------------------
  // Result assessment (leverage / aggressive / worse / neutral)
  // ---------------------------------------------------------------------
  function computeAssessment(cf, tradeoffPoints) {
    const knee = (tradeoffPoints || []).find((p) => p.isKneePoint);
    if (cf.impactReduction < 0) {
      return { cls: "worse", label: "Made it worse", note: "This intervention increased modeled contrail impact relative to the actual flight — a real, non-monotonic result the model does not smooth away." };
    }
    if (knee && knee.counterfactualId === cf.id) {
      return { cls: "leverage", label: "High-leverage option", note: "This captures a large share of the available contrail reduction without the operational cost of more aggressive alternatives." };
    }
    if (knee && cf.estimatedFuelDeltaKg > knee.operationalCost * 8) {
      return { cls: "aggressive", label: "Aggressive intervention", note: "A much larger operational cost than the high-leverage option, for further (sometimes total) impact reduction." };
    }
    return { cls: "neutral", label: "Alternative option", note: "One point among several generated alternatives — see the full tradeoff for context." };
  }

  // ---------------------------------------------------------------------
  // Pareto log-scale axis math
  // ---------------------------------------------------------------------
  function paretoScales(points, dims) {
    const { W, H, padL, padR, padT, padB } = dims;
    const costs = points.map((p) => Math.max(p.operationalCost, 0.1));
    const minCost = Math.min(...costs) * 0.6;
    const maxCost = Math.max(...costs) * 1.6;
    const logMin = Math.log10(minCost);
    const logMax = Math.log10(maxCost);
    const benefits = points.map((p) => p.contrailBenefit);
    const minB = Math.min(0, ...benefits) - 0.08;
    const maxB = Math.max(1, ...benefits) + 0.08;

    const x = (cost) => padL + ((Math.log10(Math.max(cost, 0.1)) - logMin) / (logMax - logMin)) * (W - padL - padR);
    const y = (b) => padT + (1 - (b - minB) / (maxB - minB)) * (H - padT - padB);
    return { x, y, minCost, maxCost, minB, maxB };
  }

  return {
    fmt,
    sensitivityFromAnalysis,
    buildProjection,
    project,
    latLonAltToXYZ,
    riskColor,
    findMatchingCounterfactual,
    isOffsetAvailable,
    computeAssessment,
    paretoScales,
  };
});
