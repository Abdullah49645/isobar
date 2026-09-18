const test = require("node:test");
const assert = require("node:assert/strict");
const Logic = require("../logic.js");

// ---------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------
test("fmt.tj: converts Joules to TJ with 3 decimals", () => {
  assert.equal(Logic.fmt.tj(519195502755644), "519.196 TJ");
});

test("fmt.pct: signs positive values and keeps 1 decimal", () => {
  assert.equal(Logic.fmt.pct(0.448), "+44.8%");
  assert.equal(Logic.fmt.pct(-0.308), "-30.8%");
  assert.equal(Logic.fmt.pct(0), "+0.0%");
});

test("fmt.kg: switches to tonnes above 1000kg magnitude, sign follows the value", () => {
  assert.equal(Logic.fmt.kg(4.8944), "4.9 kg");
  assert.equal(Logic.fmt.kg(3192.4), "3.19 t");
  assert.equal(Logic.fmt.kg(-3192.4), "-3.19 t");
});

test("fmt.ft: signs the value and keeps thousands separators", () => {
  assert.equal(Logic.fmt.ft(-4000), "-4,000 ft");
  assert.equal(Logic.fmt.ft(2000), "+2,000 ft");
});

test("fmt.clock: renders UTC HH:MMz", () => {
  assert.equal(Logic.fmt.clock("2026-01-15T02:09:00.000Z"), "02:09z");
});

// ---------------------------------------------------------------------
// sensitivityFromAnalysis
// ---------------------------------------------------------------------
test("sensitivityFromAnalysis: no critical window or zero impact is low", () => {
  assert.equal(Logic.sensitivityFromAnalysis({ criticalWindows: [], baselineTotalImpactJ: 0 }), "low");
  assert.equal(
    Logic.sensitivityFromAnalysis({ criticalWindows: [{ shareOfFlightImpact: 0.1 }], baselineTotalImpactJ: 0 }),
    "low"
  );
});

test("sensitivityFromAnalysis: large total impact or dominant window is high", () => {
  assert.equal(
    Logic.sensitivityFromAnalysis({ criticalWindows: [{ shareOfFlightImpact: 0.4452 }], baselineTotalImpactJ: 519195502755644 }),
    "high"
  );
});

test("sensitivityFromAnalysis: modest positive impact without a dominant window is moderate", () => {
  assert.equal(
    Logic.sensitivityFromAnalysis({ criticalWindows: [{ shareOfFlightImpact: 0.2 }], baselineTotalImpactJ: 223372390080852.94 }),
    "moderate"
  );
});

// ---------------------------------------------------------------------
// 2D projection math
// ---------------------------------------------------------------------
test("buildProjection + project: JFK and LHR endpoints land near opposite edges, not on top of each other", () => {
  const traj = [
    { latitude: 40.6413, longitude: -73.7781 }, // JFK
    { latitude: 51.4700, longitude: -0.4543 }, // LHR
  ];
  const proj = Logic.buildProjection(traj);
  const a = Logic.project(proj, traj[0].latitude, traj[0].longitude);
  const b = Logic.project(proj, traj[1].latitude, traj[1].longitude);
  assert.ok(Math.abs(a.x - b.x) > 200, "endpoints should be well separated on x");
  assert.ok(a.x >= 0 && a.x <= proj.w && b.x >= 0 && b.x <= proj.w, "points stay within canvas width");
});

test("project: the trajectory midpoint projects near the canvas center", () => {
  const traj = [
    { latitude: 10, longitude: -10 },
    { latitude: 10, longitude: 10 },
  ];
  const proj = Logic.buildProjection(traj);
  const mid = Logic.project(proj, 10, 0);
  assert.ok(Math.abs(mid.x - proj.w / 2) < 1, "midpoint x should sit at canvas center");
  assert.ok(Math.abs(mid.y - proj.h / 2) < 1, "midpoint y should sit at canvas center");
});

// ---------------------------------------------------------------------
// 3D lat/lon/alt -> xyz
// ---------------------------------------------------------------------
test("latLonAltToXYZ: a point at (0,0) with no altitude sits on the +x/equator axis at the given radius", () => {
  const p = Logic.latLonAltToXYZ(0, 0, 0, 60, 0.0004);
  assert.ok(Math.abs(p.y) < 1e-9, "equator point has ~0 y");
  const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
  assert.ok(Math.abs(dist - 60) < 1e-6, "point should lie exactly on the sphere of the given radius");
});

test("latLonAltToXYZ: higher altitude pushes the point further from the globe center", () => {
  const low = Logic.latLonAltToXYZ(40, -30, 0, 60, 0.0005);
  const high = Logic.latLonAltToXYZ(40, -30, 36000, 60, 0.0005);
  const distLow = Math.hypot(low.x, low.y, low.z);
  const distHigh = Math.hypot(high.x, high.y, high.z);
  assert.ok(distHigh > distLow, "a higher flight level should be further from the globe center");
});

// ---------------------------------------------------------------------
// riskColor
// ---------------------------------------------------------------------
test("riskColor: null sample or null forcing is neutral gray", () => {
  assert.match(Logic.riskColor(null), /^rgba\(110,130,150,/);
  assert.match(Logic.riskColor({ segmentEnergyForcingJ: null }), /^rgba\(110,130,150,/);
});

test("riskColor: net-cooling (forcing <= 0) is blue", () => {
  assert.match(Logic.riskColor({ segmentEnergyForcingJ: -1e12 }), /^rgba\(111,184,255,/);
  assert.match(Logic.riskColor({ segmentEnergyForcingJ: 0 }), /^rgba\(111,184,255,/);
});

test("riskColor: net-warming is amber-to-red, never blue or gray", () => {
  const c = Logic.riskColor({ segmentEnergyForcingJ: 2.3e13 });
  assert.match(c, /^rgba\(\d+,\d+,\d+,1\)$/);
  assert.doesNotMatch(c, /^rgba\(111,184,255/);
  assert.doesNotMatch(c, /^rgba\(110,130,150/);
});

// ---------------------------------------------------------------------
// What-If matching
// ---------------------------------------------------------------------
const SAMPLE_CFS = [
  { id: "a", strategy: { kind: "full-flight-offset", altitudeOffsetFt: -4000 } },
  { id: "b", strategy: { kind: "critical-window-descent", altitudeOffsetFt: -4000 } },
  { id: "c", strategy: { kind: "critical-window-climb", altitudeOffsetFt: 1000 } },
  { id: "d", strategy: { kind: "return-to-cruise", altitudeOffsetFt: -2000 } },
];

test("findMatchingCounterfactual: specialId short-circuits offset/mode matching", () => {
  const found = Logic.findMatchingCounterfactual(SAMPLE_CFS, "window", -4000, "d");
  assert.equal(found.id, "d");
});

test("findMatchingCounterfactual: negative offset in window mode maps to critical-window-descent", () => {
  const found = Logic.findMatchingCounterfactual(SAMPLE_CFS, "window", -4000, null);
  assert.equal(found.id, "b");
});

test("findMatchingCounterfactual: positive offset in window mode maps to critical-window-climb", () => {
  const found = Logic.findMatchingCounterfactual(SAMPLE_CFS, "window", 1000, null);
  assert.equal(found.id, "c");
});

test("findMatchingCounterfactual: full mode maps to full-flight-offset", () => {
  const found = Logic.findMatchingCounterfactual(SAMPLE_CFS, "full", -4000, null);
  assert.equal(found.id, "a");
});

test("findMatchingCounterfactual: zero or missing offset with no special selection returns null", () => {
  assert.equal(Logic.findMatchingCounterfactual(SAMPLE_CFS, "full", 0, null), null);
  assert.equal(Logic.findMatchingCounterfactual(SAMPLE_CFS, "full", null, null), null);
});

test("isOffsetAvailable: true only for combinations actually present", () => {
  assert.equal(Logic.isOffsetAvailable(SAMPLE_CFS, "full", -4000), true);
  assert.equal(Logic.isOffsetAvailable(SAMPLE_CFS, "full", 4000), false);
  assert.equal(Logic.isOffsetAvailable(SAMPLE_CFS, "window", -4000), true);
});

// ---------------------------------------------------------------------
// computeAssessment
// ---------------------------------------------------------------------
test("computeAssessment: negative reduction is always 'worse', regardless of knee status", () => {
  const cf = { id: "x", impactReduction: -0.308, estimatedFuelDeltaKg: 198 };
  const a = Logic.computeAssessment(cf, [{ isKneePoint: true, counterfactualId: "other", operationalCost: 5 }]);
  assert.equal(a.cls, "worse");
});

test("computeAssessment: the actual knee counterfactual is 'leverage'", () => {
  const cf = { id: "knee-cf", impactReduction: 0.448, estimatedFuelDeltaKg: 4.9 };
  const a = Logic.computeAssessment(cf, [{ isKneePoint: true, counterfactualId: "knee-cf", operationalCost: 4.8944 }]);
  assert.equal(a.cls, "leverage");
});

test("computeAssessment: much costlier than the knee (>8x fuel) is 'aggressive'", () => {
  const cf = { id: "big", impactReduction: 1.0, estimatedFuelDeltaKg: 3178.4 };
  const a = Logic.computeAssessment(cf, [{ isKneePoint: true, counterfactualId: "knee-cf", operationalCost: 4.8944 }]);
  assert.equal(a.cls, "aggressive");
});

test("computeAssessment: a modest positive result that isn't the knee is 'neutral'", () => {
  const cf = { id: "mid", impactReduction: 0.093, estimatedFuelDeltaKg: 20 };
  const a = Logic.computeAssessment(cf, [{ isKneePoint: true, counterfactualId: "knee-cf", operationalCost: 4.8944 }]);
  assert.equal(a.cls, "neutral");
});

test("computeAssessment: handles an empty/missing tradeoffPoints list without throwing", () => {
  const cf = { id: "solo", impactReduction: 0.2, estimatedFuelDeltaKg: 10 };
  assert.doesNotThrow(() => Logic.computeAssessment(cf, []));
  assert.doesNotThrow(() => Logic.computeAssessment(cf, undefined));
});

// ---------------------------------------------------------------------
// Pareto log-scale axis
// ---------------------------------------------------------------------
test("paretoScales: x is monotonically increasing with cost (log scale, not compressed to a point)", () => {
  const points = [
    { operationalCost: 4.8944, contrailBenefit: 0.4477 },
    { operationalCost: 87.22, contrailBenefit: 0.3405 },
    { operationalCost: 3192.4, contrailBenefit: 1.0 },
  ];
  const dims = { W: 900, H: 440, padL: 56, padR: 24, padT: 20, padB: 46 };
  const { x } = Logic.paretoScales(points, dims);
  const xs = points.map((p) => x(p.operationalCost));
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], "higher cost should always map to a larger x");
  // The whole point of the log axis: low/mid/high should not collapse together
  // the way a linear axis would with a ~650x cost spread.
  assert.ok(xs[1] - xs[0] > 20, "low-to-mid gap should be clearly visible, not compressed near 0");
});

test("paretoScales: y=0 (no benefit) and y=1 (full elimination) are within the plot's vertical bounds", () => {
  const points = [
    { operationalCost: 10, contrailBenefit: -0.3 },
    { operationalCost: 100, contrailBenefit: 1.0 },
  ];
  const dims = { W: 900, H: 440, padL: 56, padR: 24, padT: 20, padB: 46 };
  const { y } = Logic.paretoScales(points, dims);
  assert.ok(y(0) > dims.padT && y(0) < dims.H - dims.padB);
  assert.ok(y(1) > dims.padT && y(1) < dims.H - dims.padB);
  assert.ok(y(1) < y(0), "higher benefit should plot higher on screen (smaller y)");
});

test("paretoScales: a negative (non-monotonic/worse) point plots below the zero line, not clipped away", () => {
  const points = [
    { operationalCost: 198, contrailBenefit: -0.308 },
    { operationalCost: 20, contrailBenefit: 0.1 },
  ];
  const dims = { W: 900, H: 440, padL: 56, padR: 24, padT: 20, padB: 46 };
  const { y } = Logic.paretoScales(points, dims);
  assert.ok(y(-0.308) > y(0), "a negative benefit point should sit below the zero line on screen");
});
