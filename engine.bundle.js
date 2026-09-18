"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/utils/geo.ts
  var EARTH_RADIUS_M = 6371e3;
  function toRad(deg) {
    return deg * Math.PI / 180;
  }
  function toDeg(rad) {
    return rad * 180 / Math.PI;
  }
  function haversineMeters(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_M * c;
  }
  function greatCircleInterpolate(lat1, lon1, lat2, lon2, fraction) {
    const phi1 = toRad(lat1);
    const lambda1 = toRad(lon1);
    const phi2 = toRad(lat2);
    const lambda2 = toRad(lon2);
    const dLat = phi2 - phi1;
    const dLon = lambda2 - lambda1;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLon / 2) ** 2;
    const angularDistance = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (angularDistance === 0) {
      return { latitude: lat1, longitude: lon1 };
    }
    const A = Math.sin((1 - fraction) * angularDistance) / Math.sin(angularDistance);
    const B = Math.sin(fraction * angularDistance) / Math.sin(angularDistance);
    const x = A * Math.cos(phi1) * Math.cos(lambda1) + B * Math.cos(phi2) * Math.cos(lambda2);
    const y = A * Math.cos(phi1) * Math.sin(lambda1) + B * Math.cos(phi2) * Math.sin(lambda2);
    const z = A * Math.sin(phi1) + B * Math.sin(phi2);
    const phi3 = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lambda3 = Math.atan2(y, x);
    return { latitude: toDeg(phi3), longitude: toDeg(lambda3) };
  }
  function isaTemperatureK(altitudeFt) {
    const altitudeM = altitudeFt * 0.3048;
    const TROPOPAUSE_M = 11e3;
    const SEA_LEVEL_TEMP_K = 288.15;
    const LAPSE_RATE_K_PER_M = 65e-4;
    const TROPOPAUSE_TEMP_K = SEA_LEVEL_TEMP_K - LAPSE_RATE_K_PER_M * TROPOPAUSE_M;
    if (altitudeM <= TROPOPAUSE_M) {
      return SEA_LEVEL_TEMP_K - LAPSE_RATE_K_PER_M * altitudeM;
    }
    return TROPOPAUSE_TEMP_K;
  }
  function hashNoise(...values) {
    let h = 2166136261;
    for (const v of values) {
      const bits = Math.floor(v * 1e3);
      h ^= bits;
      h = Math.imul(h, 16777619);
    }
    h ^= h >>> 15;
    h = Math.imul(h, 2246822519);
    h ^= h >>> 13;
    h = Math.imul(h, 3266489917);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // src/science/trajectory.ts
  var MAX_PLAUSIBLE_GROUND_SPEED_KTS = 700;
  function cleanTrajectory(raw) {
    const sorted = [...raw].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const points = [];
    let droppedDuplicates = 0;
    const flaggedOutliers = [];
    for (const point of sorted) {
      const prev = points[points.length - 1];
      if (prev && prev.timestamp === point.timestamp) {
        droppedDuplicates++;
        continue;
      }
      if (prev) {
        const dtSec = (new Date(point.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1e3;
        if (dtSec > 0) {
          const distM = haversineMeters(prev.latitude, prev.longitude, point.latitude, point.longitude);
          const impliedSpeedKts = distM / dtSec * 1.94384;
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

  // src/science/criticalWindow.ts
  function detectCriticalWindows(annotated, options = {}) {
    const minDurationSec = options.minDurationSec ?? 300;
    const maxDurationFraction = options.maxDurationFraction ?? 0.5;
    const targetShare = options.targetShare ?? 0.4;
    const positiveForcings = annotated.map((a) => {
      const ef = a.sample?.segmentEnergyForcingJ;
      return ef !== null && ef !== void 0 && ef > 0 ? ef : 0;
    });
    const totalPositive = positiveForcings.reduce((s, v) => s + v, 0);
    if (totalPositive <= 0 || annotated.length < 2) {
      return [];
    }
    const firstTs = new Date(annotated[0].point.timestamp).getTime();
    const lastTs = new Date(annotated[annotated.length - 1].point.timestamp).getTime();
    const totalDurationSec = (lastTs - firstTs) / 1e3;
    const maxDurationSec = totalDurationSec * maxDurationFraction;
    const prefix = new Array(positiveForcings.length + 1).fill(0);
    for (let i = 0; i < positiveForcings.length; i++) {
      prefix[i + 1] = prefix[i] + positiveForcings[i];
    }
    const timestamps = annotated.map((a) => new Date(a.point.timestamp).getTime());
    let best = null;
    for (let start = 0; start < annotated.length - 1; start++) {
      for (let end = start + 1; end < annotated.length; end++) {
        const durationSec = (timestamps[end] - timestamps[start]) / 1e3;
        if (durationSec < minDurationSec) continue;
        if (durationSec > maxDurationSec) break;
        const sum = prefix[end + 1] - prefix[start];
        const share = sum / totalPositive;
        if (share < targetShare) continue;
        if (!best || durationSec < best.durationSec || durationSec === best.durationSec && sum > best.sum) {
          best = { start, end, sum, durationSec };
        }
        break;
      }
    }
    if (!best) {
      for (let start = 0; start < annotated.length - 1; start++) {
        for (let end = start + 1; end < annotated.length; end++) {
          const durationSec = (timestamps[end] - timestamps[start]) / 1e3;
          if (durationSec < minDurationSec) continue;
          if (durationSec > maxDurationSec) break;
          const sum = prefix[end + 1] - prefix[start];
          if (!best || sum > best.sum) {
            best = { start, end, sum, durationSec };
          }
        }
      }
    }
    if (!best) return [];
    const windowConfidences = annotated.slice(best.start, best.end + 1).map((a) => a.sample?.confidence ?? "low");
    const confidence = windowConfidences.includes("low") ? "low" : windowConfidences.includes("medium") ? "medium" : "high";
    return [
      {
        startTimestamp: annotated[best.start].point.timestamp,
        endTimestamp: annotated[best.end].point.timestamp,
        startIndex: best.start,
        endIndex: best.end,
        durationSec: best.durationSec,
        totalPositiveEnergyForcingJ: best.sum,
        shareOfFlightImpact: best.sum / totalPositive,
        confidence
      }
    ];
  }

  // src/science/impact.ts
  function totalEnergyForcingJ(annotated) {
    return annotated.reduce((sum, a) => {
      const ef = a.sample?.segmentEnergyForcingJ;
      return sum + (ef ?? 0);
    }, 0);
  }
  function rollupConfidence(annotated) {
    const seen = new Set(annotated.map((a) => a.sample?.confidence ?? "low"));
    if (seen.has("low")) return "low";
    if (seen.has("medium")) return "medium";
    return "high";
  }
  function missingDataFraction(annotated) {
    if (annotated.length === 0) return 0;
    const missing = annotated.filter((a) => a.sample === null).length;
    return missing / annotated.length;
  }

  // src/science/pareto.ts
  function buildTradeoffPoints(counterfactuals) {
    const points = counterfactuals.map((cf) => ({
      counterfactualId: cf.id,
      operationalCost: Math.abs(cf.estimatedFuelDeltaKg),
      contrailBenefit: cf.impactReduction,
      uncertainty: cf.uncertainty.level,
      strategy: cf.strategy,
      isNonDominated: false,
      isKneePoint: false
    }));
    markNonDominated(points);
    markKneePoint(points);
    return points;
  }
  function markNonDominated(points) {
    for (const p of points) {
      p.isNonDominated = !points.some(
        (other) => other !== p && other.operationalCost <= p.operationalCost && other.contrailBenefit >= p.contrailBenefit && (other.operationalCost < p.operationalCost || other.contrailBenefit > p.contrailBenefit)
      );
    }
  }
  function markKneePoint(points) {
    const frontier = points.filter((p) => p.isNonDominated);
    if (frontier.length === 0) return;
    if (frontier.length === 1) {
      frontier[0].isKneePoint = true;
      return;
    }
    const costs = frontier.map((p) => p.operationalCost);
    const benefits = frontier.map((p) => p.contrailBenefit);
    const minCost = Math.min(...costs);
    const maxCost = Math.max(...costs);
    const minBenefit = Math.min(...benefits);
    const maxBenefit = Math.max(...benefits);
    const costRange = maxCost - minCost || 1;
    const benefitRange = maxBenefit - minBenefit || 1;
    let best = null;
    let bestScore = -Infinity;
    for (const p of frontier) {
      const normCost = (p.operationalCost - minCost) / costRange;
      const normBenefit = (p.contrailBenefit - minBenefit) / benefitRange;
      const score = normBenefit - normCost;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best) best.isKneePoint = true;
  }

  // src/simulation/altitudeProfile.ts
  var DEFAULT_KINEMATIC_ASSUMPTIONS = {
    climbRateFtPerMin: 800,
    // step-climb rate at cruise altitude, conservative
    descentRateFtPerMin: 1500,
    // cruise-altitude step-descent, conservative
    /** Absolute altitude bounds outside which we refuse to generate a counterfactual. */
    minAltitudeFt: 28e3,
    maxAltitudeFt: 43e3
  };
  function applyAltitudeWindow(points, window, kinematics = DEFAULT_KINEMATIC_ASSUMPTIONS) {
    const notes = [];
    const rateFtPerMin = window.offsetFt < 0 ? kinematics.descentRateFtPerMin : kinematics.climbRateFtPerMin;
    const transitionSec = Math.abs(window.offsetFt) / rateFtPerMin * 60;
    const times = points.map((p) => new Date(p.timestamp).getTime() / 1e3);
    const startTime = times[window.startIndex];
    const endTime = times[window.endIndex];
    const rampInStart = startTime - transitionSec;
    const rampOutEnd = endTime + transitionSec;
    let withinKinematicLimits = true;
    if (rampInStart < times[0]) {
      withinKinematicLimits = false;
      notes.push(
        "Requested altitude change cannot complete before the critical window begins at the assumed transition rate; ramp is truncated to the start of the available trajectory."
      );
    }
    if (!window.permanent && rampOutEnd > times[times.length - 1]) {
      withinKinematicLimits = false;
      notes.push(
        "Requested return-to-cruise cannot complete before the trajectory ends at the assumed transition rate; ramp is truncated to the end of the available trajectory."
      );
    }
    const altitudes = points.map((point, i) => {
      const base = point.altitudeFt;
      const t = times[i];
      if (t < Math.max(rampInStart, times[0])) {
        return base;
      }
      if (t >= Math.max(rampInStart, times[0]) && t < startTime) {
        const denom = startTime - Math.max(rampInStart, times[0]);
        const fraction = denom > 0 ? (t - Math.max(rampInStart, times[0])) / denom : 1;
        return base + fraction * window.offsetFt;
      }
      if (t >= startTime && t <= endTime) {
        return base + window.offsetFt;
      }
      if (window.permanent) {
        return base + window.offsetFt;
      }
      const rampOutEndClamped2 = Math.min(rampOutEnd, times[times.length - 1]);
      if (t > endTime && t <= rampOutEndClamped2) {
        const denom = rampOutEndClamped2 - endTime;
        const fraction = denom > 0 ? (t - endTime) / denom : 1;
        return base + (1 - fraction) * window.offsetFt;
      }
      return base;
    });
    const rampInStartClamped = Math.max(rampInStart, times[0]);
    const rampOutEndClamped = window.permanent ? times[times.length - 1] : Math.min(rampOutEnd, times[times.length - 1]);
    const affectedAltitudes = altitudes.filter((_, i) => {
      const t = times[i];
      return t >= rampInStartClamped && t <= rampOutEndClamped;
    });
    const minAlt = Math.min(...affectedAltitudes);
    const maxAlt = Math.max(...affectedAltitudes);
    const withinServiceCeiling = minAlt >= kinematics.minAltitudeFt && maxAlt <= kinematics.maxAltitudeFt;
    if (!withinServiceCeiling) {
      notes.push(
        `Resulting altitude range [${Math.round(minAlt)}, ${Math.round(maxAlt)}] ft exceeds the assumed service ceiling bounds [${kinematics.minAltitudeFt}, ${kinematics.maxAltitudeFt}] ft for this aircraft class.`
      );
    }
    return {
      altitudes,
      feasibility: { withinServiceCeiling, withinKinematicLimits, notes }
    };
  }
  function findCruiseRange(points, minAltitudeFt = 15e3, maxVerticalRateFtPerMin = 150) {
    const rates = new Array(points.length).fill(0);
    for (let i = 1; i < points.length; i++) {
      const dtMin = (new Date(points[i].timestamp).getTime() - new Date(points[i - 1].timestamp).getTime()) / 6e4;
      rates[i] = dtMin > 0 ? (points[i].altitudeFt - points[i - 1].altitudeFt) / dtMin : 0;
    }
    let start = -1;
    let end = -1;
    points.forEach((p, i) => {
      const isLevel = Math.abs(rates[i]) <= maxVerticalRateFtPerMin;
      if (p.altitudeFt >= minAltitudeFt && isLevel) {
        if (start === -1) start = i;
        end = i;
      }
    });
    if (start === -1) return null;
    return { startIndex: start, endIndex: end };
  }

  // src/models/aircraftCatalog.ts
  var AIRCRAFT_CATALOG = {
    B789: {
      icaoType: "B789",
      displayName: "Boeing 787-9",
      aircraftClass: "widebody",
      referenceMassKg: 254e3,
      typicalCruiseMassKg: 19e4,
      typicalCruiseTasKts: 488,
      source: "public-documentation"
    },
    A20N: {
      icaoType: "A20N",
      displayName: "Airbus A320neo",
      aircraftClass: "narrowbody",
      referenceMassKg: 79e3,
      typicalCruiseMassKg: 68e3,
      typicalCruiseTasKts: 447,
      source: "public-documentation"
    },
    E190: {
      icaoType: "E190",
      displayName: "Embraer E190",
      aircraftClass: "regional",
      referenceMassKg: 51800,
      typicalCruiseMassKg: 42e3,
      typicalCruiseTasKts: 420,
      source: "public-documentation"
    }
  };
  var TYPICAL_CRUISE_FUEL_FLOW_KG_PER_HOUR = {
    widebody: 5600,
    narrowbody: 2450,
    regional: 1500
  };
  var JET_FUEL_CO2_FACTOR_KG_PER_KG = 3.16;

  // src/simulation/operationalCost.ts
  var FUEL_PENALTY_K_PER_1000FT_SQUARED = 6e-3;
  var GAMMA_AIR = 1.4;
  var R_SPECIFIC_AIR = 287.05;
  function speedOfSoundMs(temperatureK) {
    return Math.sqrt(GAMMA_AIR * R_SPECIFIC_AIR * temperatureK);
  }
  function estimateOperationalCost(baseline, counterfactual, aircraft) {
    if (baseline.length !== counterfactual.length) {
      throw new Error("baseline and counterfactual trajectories must have matching waypoint counts");
    }
    const baseFuelFlowKgPerSec = TYPICAL_CRUISE_FUEL_FLOW_KG_PER_HOUR[aircraft.aircraftClass] / 3600;
    let fuelDeltaKg = 0;
    let timeDeltaSec = 0;
    for (let i = 0; i < baseline.length - 1; i++) {
      const b0 = baseline[i];
      const b1 = baseline[i + 1];
      const c0 = counterfactual[i];
      const c1 = counterfactual[i + 1];
      const dtSec = (new Date(b1.timestamp).getTime() - new Date(b0.timestamp).getTime()) / 1e3;
      if (dtSec <= 0) continue;
      const offsetFt = (c0.altitudeFt - b0.altitudeFt + (c1.altitudeFt - b1.altitudeFt)) / 2;
      if (offsetFt === 0) continue;
      const penaltyFraction = FUEL_PENALTY_K_PER_1000FT_SQUARED * (offsetFt / 1e3) ** 2;
      fuelDeltaKg += baseFuelFlowKgPerSec * dtSec * penaltyFraction;
      const baseTasKts = b0.groundSpeedKts ?? aircraft.typicalCruiseTasKts;
      const baseTempK = isaTemperatureK(b0.altitudeFt);
      const newTempK = isaTemperatureK(c0.altitudeFt);
      const mach = baseTasKts * 0.514444 / speedOfSoundMs(baseTempK);
      const newTasMs = mach * speedOfSoundMs(newTempK);
      const newTasKts = newTasMs / 0.514444;
      if (newTasKts > 0) {
        const segmentDistanceNm = baseTasKts * dtSec / 3600;
        const baseSegTimeSec = dtSec;
        const newSegTimeSec = segmentDistanceNm / newTasKts * 3600;
        timeDeltaSec += newSegTimeSec - baseSegTimeSec;
      }
    }
    const co2DeltaKg = fuelDeltaKg * JET_FUEL_CO2_FACTOR_KG_PER_KG;
    return {
      fuelDeltaKg,
      co2DeltaKg,
      timeDeltaSec,
      assumptions: [
        "Fuel-flow penalty is a simplified parabolic approximation around the flight's actual recorded altitude, not a certified aircraft performance model.",
        "Time delta assumes a constant cruise Mach number and ICAO Standard Atmosphere temperatures; wind is not modeled.",
        `CO2 delta uses the standard ${JET_FUEL_CO2_FACTOR_KG_PER_KG} kg CO2 per kg jet fuel combustion factor.`
      ]
    };
  }

  // src/simulation/counterfactualEngine.ts
  function windowSpecFor(baseline, strategy, criticalWindows) {
    const { kind, altitudeOffsetFt, windowIndex } = strategy;
    if (kind === "full-flight-offset") {
      const cruise = findCruiseRange(baseline);
      if (!cruise) {
        throw new Error("Cannot apply a full-flight offset: no cruise-altitude segment found.");
      }
      return { startIndex: cruise.startIndex, endIndex: cruise.endIndex, offsetFt: altitudeOffsetFt, permanent: false };
    }
    const cw = criticalWindows[windowIndex ?? 0];
    if (!cw) {
      throw new Error("Localized strategy requires a valid critical window index.");
    }
    switch (kind) {
      case "critical-window-descent":
        return { startIndex: cw.startIndex, endIndex: cw.endIndex, offsetFt: -Math.abs(altitudeOffsetFt), permanent: false };
      case "critical-window-climb":
        return { startIndex: cw.startIndex, endIndex: cw.endIndex, offsetFt: Math.abs(altitudeOffsetFt), permanent: false };
      case "return-to-cruise": {
        const marginIndices = Math.max(2, Math.round((cw.endIndex - cw.startIndex) * 0.5));
        const startIndex = Math.max(0, cw.startIndex - marginIndices);
        const endIndex = Math.min(baseline.length - 1, cw.endIndex + marginIndices);
        return { startIndex, endIndex, offsetFt: altitudeOffsetFt, permanent: false };
      }
      case "multi-step-profile": {
        return { startIndex: cw.startIndex, endIndex: cw.endIndex, offsetFt: altitudeOffsetFt, permanent: false };
      }
      default:
        throw new Error(`Unhandled strategy kind: ${kind}`);
    }
  }
  async function generateCounterfactual(flightId, baselineAnnotated, aircraft, strategy, criticalWindows, provider, options = {}) {
    const baseline = baselineAnnotated.map((a) => a.point);
    const spec = windowSpecFor(baseline, strategy, criticalWindows);
    let altitudes;
    let feasibility;
    if (strategy.kind === "multi-step-profile") {
      const stage1 = applyAltitudeWindow(
        baseline,
        { ...spec, offsetFt: spec.offsetFt / 2 },
        DEFAULT_KINEMATIC_ASSUMPTIONS
      );
      const stage1Trajectory = baseline.map((p, i) => ({ ...p, altitudeFt: stage1.altitudes[i] }));
      const stage2 = applyAltitudeWindow(stage1Trajectory, spec, DEFAULT_KINEMATIC_ASSUMPTIONS);
      altitudes = stage2.altitudes;
      feasibility = {
        withinServiceCeiling: stage1.feasibility.withinServiceCeiling && stage2.feasibility.withinServiceCeiling,
        withinKinematicLimits: stage1.feasibility.withinKinematicLimits && stage2.feasibility.withinKinematicLimits,
        notes: [...stage1.feasibility.notes, ...stage2.feasibility.notes]
      };
    } else {
      const result = applyAltitudeWindow(baseline, spec, DEFAULT_KINEMATIC_ASSUMPTIONS);
      altitudes = result.altitudes;
      feasibility = result.feasibility;
    }
    const modifiedTrajectory = baseline.map((p, i) => ({
      ...p,
      altitudeFt: altitudes[i],
      interpolated: false
    }));
    if (!feasibility.withinServiceCeiling || !feasibility.withinKinematicLimits) {
    }
    const samples = await provider.sampleTrajectory(modifiedTrajectory);
    const annotated = modifiedTrajectory.map((point, i) => ({
      point,
      sample: samples[i] ?? null
    }));
    const baselineImpactJ = totalEnergyForcingJ(baselineAnnotated);
    const contrailImpactJ = totalEnergyForcingJ(annotated);
    const impactReduction = baselineImpactJ !== 0 ? (baselineImpactJ - contrailImpactJ) / Math.abs(baselineImpactJ) : 0;
    const cost = estimateOperationalCost(baseline, modifiedTrajectory, aircraft);
    const missingFraction = Math.max(missingDataFraction(baselineAnnotated), missingDataFraction(annotated));
    const confidenceReasons = [
      "Atmospheric field is a synthetic demo approximation, not a live weather model run (see demo-data/README.md).",
      "Fuel/time deltas use a simplified operational model (see src/simulation/operationalCost.ts).",
      "Trajectory interpolation resolution follows the original observation cadence."
    ];
    if (missingFraction > 0) {
      confidenceReasons.push(`${Math.round(missingFraction * 100)}% of waypoints had no atmospheric sample available.`);
    }
    const uncertaintyLevel = missingFraction > 0.1 || rollupConfidence(annotated) === "low" ? "high" : rollupConfidence(annotated) === "medium" ? "medium" : "low";
    return {
      id: `${options.idPrefix ?? "cf"}-${strategy.kind}-${strategy.altitudeOffsetFt}-${Date.now()}`,
      flightId,
      strategy,
      modifiedTrajectory,
      altitudeProfileFt: altitudes,
      annotated,
      baselineImpactJ,
      contrailImpactJ,
      impactReduction,
      estimatedFuelDeltaKg: cost.fuelDeltaKg,
      estimatedCO2DeltaKg: cost.co2DeltaKg,
      estimatedTimeDeltaSec: cost.timeDeltaSec,
      uncertainty: { level: uncertaintyLevel, reasons: confidenceReasons },
      feasibilityFlags: feasibility
    };
  }

  // src/science/pipeline.ts
  function standardStrategySet(windowIndex) {
    const offsets = [-4e3, -2e3, -1e3, 1e3, 2e3, 4e3];
    const strategies = [];
    for (const offsetFt of offsets) {
      strategies.push({ kind: "full-flight-offset", altitudeOffsetFt: offsetFt });
      strategies.push({
        kind: offsetFt < 0 ? "critical-window-descent" : "critical-window-climb",
        altitudeOffsetFt: offsetFt,
        windowIndex
      });
    }
    strategies.push({ kind: "return-to-cruise", altitudeOffsetFt: -2e3, windowIndex });
    strategies.push({ kind: "return-to-cruise", altitudeOffsetFt: -4e3, windowIndex });
    strategies.push({ kind: "multi-step-profile", altitudeOffsetFt: -4e3, windowIndex });
    return strategies;
  }
  async function analyzeFlight(flight, provider) {
    const { points: cleanedPoints } = cleanTrajectory(flight.trajectory);
    const samples = await provider.sampleTrajectory(cleanedPoints);
    const baselineAnnotated = cleanedPoints.map((point, i) => ({
      point,
      sample: samples[i] ?? null
    }));
    const baselineTotalImpactJ = totalEnergyForcingJ(baselineAnnotated);
    const criticalWindows = detectCriticalWindows(baselineAnnotated);
    const counterfactuals = [];
    if (criticalWindows.length > 0) {
      const strategies = standardStrategySet(0);
      for (const strategy of strategies) {
        try {
          const cf = await generateCounterfactual(
            flight.id,
            baselineAnnotated,
            flight.aircraft,
            strategy,
            criticalWindows,
            provider,
            { idPrefix: flight.id }
          );
          counterfactuals.push(cf);
        } catch (err) {
          console.warn(`Skipping infeasible strategy ${strategy.kind}/${strategy.altitudeOffsetFt}ft: ${err.message}`);
        }
      }
    }
    const tradeoffPoints = buildTradeoffPoints(counterfactuals);
    return {
      flight: { ...flight, trajectory: cleanedPoints },
      baselineAnnotated,
      baselineTotalImpactJ,
      criticalWindows,
      counterfactuals,
      tradeoffPoints
    };
  }

  // src/science/atmosphericField.ts
  var EF_PERCENTILE_TABLE = [
    [1, -639e6],
    [5, -195e6],
    [10, -693e5],
    [15, -245e5],
    [20, -778e4],
    [25, -269e4],
    [30, -147e4],
    [35, -274e3],
    [40, 905e3],
    [45, 631e4],
    [50, 174e5],
    [55, 372e5],
    [60, 706e5],
    [65, 123e6],
    [70, 2e8],
    [75, 307e6],
    [80, 457e6],
    [85, 672e6],
    [90, 101e7],
    [95, 163e7],
    [99, 314e7]
  ];
  function efPerMeterAtPercentile(percentile) {
    const p = Math.max(1, Math.min(99, percentile));
    for (let i = 0; i < EF_PERCENTILE_TABLE.length - 1; i++) {
      const [p0, v0] = EF_PERCENTILE_TABLE[i];
      const [p1, v1] = EF_PERCENTILE_TABLE[i + 1];
      if (p >= p0 && p <= p1) {
        const t = (p - p0) / (p1 - p0);
        return v0 + t * (v1 - v0);
      }
    }
    return EF_PERCENTILE_TABLE[EF_PERCENTILE_TABLE.length - 1][1];
  }
  var SyntheticAtmosphericField = class {
    constructor(patches) {
      __publicField(this, "patches", patches);
    }
    patchIntensityAt(lat, lon, flightLevel, timestamp) {
      const t = new Date(timestamp).getTime();
      let total = 0;
      for (const patch of this.patches) {
        const refT = new Date(patch.referenceTime).getTime();
        const hoursElapsed = (t - refT) / 36e5;
        const centerLat = patch.lat0 + patch.latDriftPerHour * hoursElapsed;
        const centerLon = patch.lon0 + patch.lonDriftPerHour * hoursElapsed;
        const distKm = haversineMeters(lat, lon, centerLat, centerLon) / 1e3;
        const horizontal = Math.exp(-(distKm ** 2) / (2 * patch.horizontalSigmaKm ** 2));
        const flDelta = flightLevel - patch.centerFlightLevel;
        const vertical = Math.exp(-(flDelta ** 2) / (2 * patch.verticalSigmaFl ** 2));
        total += patch.peakIntensity * horizontal * vertical;
      }
      return total;
    }
    sample(lat, lon, altitudeFt, timestamp) {
      const flightLevel = Math.round(altitudeFt / 100 / 10) * 10;
      const moistureIndex = this.patchIntensityAt(lat, lon, flightLevel, timestamp);
      const jitter = (hashNoise(lat * 100, lon * 100, flightLevel, new Date(timestamp).getTime() / 6e4) - 0.5) * 0.06;
      const clampedMoisture = Math.max(0, Math.min(1.3, moistureIndex + jitter));
      const baseTempK = isaTemperatureK(altitudeFt);
      const temperatureK = baseTempK - 3.5 * Math.min(1, clampedMoisture);
      const relativeHumidityIcePct = 28 + clampedMoisture * 95;
      const sac = temperatureK < 235 ? 1 : 0;
      const issr = relativeHumidityIcePct > 100 ? 1 : 0;
      let persistentContrailProbability = 0;
      if (sac === 1) {
        const margin = (relativeHumidityIcePct - 92) / 30;
        persistentContrailProbability = Math.max(0, Math.min(1, margin));
      }
      let segmentEnergyForcingJPerMeter = null;
      if (persistentContrailProbability > 0.05) {
        const roll = hashNoise(lat * 37, lon * 41, flightLevel * 3, new Date(timestamp).getTime() / 3e5);
        const skew = 1 + 2.5 * persistentContrailProbability;
        const percentile = 100 * (1 - (1 - roll) ** skew);
        segmentEnergyForcingJPerMeter = efPerMeterAtPercentile(percentile);
      }
      const confidence = clampedMoisture > 0.15 && clampedMoisture < 0.95 ? "low" : "medium";
      return {
        timestamp,
        latitude: lat,
        longitude: lon,
        flightLevel,
        temperatureK,
        relativeHumidityIcePct,
        sac,
        issr,
        persistentContrailProbability: sac === 1 ? persistentContrailProbability : null,
        // segmentEnergyForcingJ is finalized by the caller once segment length
        // is known (energy forcing is a per-segment, not per-point, quantity -
        // see https://apidocs.contrails.org/ef-interpretation.html). We stash
        // the per-meter figure in a side channel via the return value below.
        segmentEnergyForcingJ: segmentEnergyForcingJPerMeter,
        confidence
      };
    }
  };
  function defaultNorthAtlanticPatches(referenceTime) {
    return [
      {
        lat0: 52.5,
        lon0: -35,
        latDriftPerHour: 0.15,
        lonDriftPerHour: 0.8,
        centerFlightLevel: 350,
        verticalSigmaFl: 18,
        horizontalSigmaKm: 260,
        referenceTime,
        peakIntensity: 1.15
      },
      {
        lat0: 47,
        lon0: -60,
        latDriftPerHour: -0.05,
        lonDriftPerHour: 0.6,
        centerFlightLevel: 310,
        verticalSigmaFl: 22,
        horizontalSigmaKm: 200,
        referenceTime,
        peakIntensity: 0.55
      }
    ];
  }

  // src/data/providers/demoDatasetProvider.ts
  var DemoDatasetProvider = class {
    constructor(referenceTime) {
      __publicField(this, "id", "demo-dataset");
      __publicField(this, "field");
      this.field = new SyntheticAtmosphericField(defaultNorthAtlanticPatches(referenceTime));
    }
    async isAvailable() {
      return true;
    }
    async sampleTrajectory(points) {
      return points.map((point, i) => {
        const raw = this.field.sample(point.latitude, point.longitude, point.altitudeFt, point.timestamp);
        let segmentEnergyForcingJ = null;
        if (raw.segmentEnergyForcingJ !== null) {
          const next = points[i + 1];
          const segmentLengthM = next ? haversineMeters(point.latitude, point.longitude, next.latitude, next.longitude) : 0;
          segmentEnergyForcingJ = raw.segmentEnergyForcingJ * segmentLengthM;
        }
        const sample = {
          ...raw,
          segmentEnergyForcingJ,
          providerId: this.id
        };
        return sample;
      });
    }
  };

  // src/data/demoFlights.ts
  function buildTrajectory(spec) {
    const { origin, destination, departureTime, totalDurationSec, phases, samplingIntervalSec } = spec;
    const depTimeMs = new Date(departureTime).getTime();
    const totalRouteDistanceM = haversineMeters(origin.lat, origin.lon, destination.lat, destination.lon);
    const stepCount = Math.floor(totalDurationSec / samplingIntervalSec) + 1;
    const rawDistances = [0];
    const altitudes = [];
    const speeds = [];
    let prevAltitudeFt = 0;
    let phaseStartFraction = 0;
    let phaseStartAltitudeFt = 0;
    for (let i = 0; i < stepCount; i++) {
      const tSec = i * samplingIntervalSec;
      const fraction = tSec / totalDurationSec;
      let phase = phases[0];
      let cumulativeStart = 0;
      for (const p of phases) {
        if (fraction <= p.endFraction || p === phases[phases.length - 1]) {
          phase = p;
          break;
        }
        cumulativeStart = p.endFraction;
      }
      if (fraction > phaseStartFraction && phases.indexOf(phase) > 0) {
      }
      const phaseIndex = phases.indexOf(phase);
      const prevPhaseEndFraction = phaseIndex === 0 ? 0 : phases[phaseIndex - 1].endFraction;
      const prevPhaseEndAltitude = phaseIndex === 0 ? 0 : phases[phaseIndex - 1].endAltitudeFt;
      const phaseFraction = phase.endFraction > prevPhaseEndFraction ? (fraction - prevPhaseEndFraction) / (phase.endFraction - prevPhaseEndFraction) : 1;
      const clampedPhaseFraction = Math.max(0, Math.min(1, phaseFraction));
      const eased = clampedPhaseFraction * clampedPhaseFraction * (3 - 2 * clampedPhaseFraction);
      const altitudeFt = prevPhaseEndAltitude + eased * (phase.endAltitudeFt - prevPhaseEndAltitude);
      altitudes.push(altitudeFt);
      speeds.push(phase.groundSpeedKts);
      prevAltitudeFt = altitudeFt;
      if (i > 0) {
        const dtSec = samplingIntervalSec;
        const avgSpeedKts = (speeds[i] + speeds[i - 1]) / 2;
        const distStepM = avgSpeedKts * 0.514444 * dtSec;
        rawDistances.push(rawDistances[i - 1] + distStepM);
      }
    }
    void prevAltitudeFt;
    void phaseStartFraction;
    void phaseStartAltitudeFt;
    const rawTotal = rawDistances[rawDistances.length - 1];
    const scale = totalRouteDistanceM / rawTotal;
    const points = [];
    for (let i = 0; i < stepCount; i++) {
      const distanceFraction = rawDistances[i] * scale / totalRouteDistanceM;
      const { latitude, longitude } = greatCircleInterpolate(
        origin.lat,
        origin.lon,
        destination.lat,
        destination.lon,
        Math.max(0, Math.min(1, distanceFraction))
      );
      points.push({
        timestamp: new Date(depTimeMs + i * samplingIntervalSec * 1e3).toISOString(),
        latitude,
        longitude,
        altitudeFt: Math.round(altitudes[i]),
        groundSpeedKts: Math.round(speeds[i]),
        interpolated: false,
        sourceResolutionSec: i < stepCount - 1 ? samplingIntervalSec : void 0
      });
    }
    return points;
  }
  function buildFlight(spec) {
    const trajectory = buildTrajectory(spec);
    const arrivalTime = trajectory[trajectory.length - 1].timestamp;
    return {
      id: spec.id,
      callsign: spec.callsign,
      origin: spec.origin.iata,
      destination: spec.destination.iata,
      departureTime: spec.departureTime,
      arrivalTime,
      aircraft: AIRCRAFT_CATALOG[spec.aircraftIcaoType],
      trajectory,
      dataProvenance: {
        source: "reconstructed-representative",
        note: spec.provenanceNote
      }
    };
  }
  function buildDemoFlightJfkLhr() {
    return buildFlight({
      id: "demo-jfk-lhr-b789",
      callsign: "DEMO101",
      origin: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
      destination: { iata: "LHR", lat: 51.47, lon: -0.4543 },
      departureTime: "2026-01-14T22:10:00Z",
      // overnight eastbound departure, typical for this route
      aircraftIcaoType: "B789",
      totalDurationSec: 410 * 60,
      // 6h50m, typical eastbound block time with jet-stream assist
      samplingIntervalSec: 60,
      phases: [
        { endFraction: 28 / 410, endAltitudeFt: 34e3, groundSpeedKts: 340 },
        // climb
        { endFraction: 150 / 410, endAltitudeFt: 34e3, groundSpeedKts: 505 },
        // cruise 1 (FL340)
        { endFraction: 155 / 410, endAltitudeFt: 36e3, groundSpeedKts: 505 },
        // step climb
        { endFraction: 280 / 410, endAltitudeFt: 36e3, groundSpeedKts: 520 },
        // cruise 2 (FL360) - through the patch
        { endFraction: 285 / 410, endAltitudeFt: 38e3, groundSpeedKts: 520 },
        // step climb
        { endFraction: 380 / 410, endAltitudeFt: 38e3, groundSpeedKts: 500 },
        // cruise 3 (FL380)
        { endFraction: 1, endAltitudeFt: 2500, groundSpeedKts: 250 }
        // descent
      ],
      provenanceNote: "Reconstructed representative trajectory for a JFK-LHR Boeing 787-9 eastbound service: great-circle route between the two airports, with a phase-of-flight altitude/speed profile (climb, two operational step-climbs, cruise, descent) built from publicly documented typical operating patterns for this route and aircraft type. This is NOT a specific recorded flight's ADS-B telemetry - live historical retrieval from OpenSky requires network/account access unavailable in this build environment. See demo-data/README.md."
    });
  }
  function buildDemoFlightJfkLhrClearSkies() {
    return buildFlight({
      id: "demo-jfk-lhr-b789-clear",
      callsign: "DEMO202",
      origin: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
      destination: { iata: "LHR", lat: 51.47, lon: -0.4543 },
      departureTime: "2026-01-16T13:30:00Z",
      // different time of day / day -> patch has drifted past
      aircraftIcaoType: "B789",
      totalDurationSec: 400 * 60,
      samplingIntervalSec: 60,
      phases: [
        { endFraction: 28 / 400, endAltitudeFt: 34e3, groundSpeedKts: 340 },
        { endFraction: 150 / 400, endAltitudeFt: 34e3, groundSpeedKts: 500 },
        { endFraction: 155 / 400, endAltitudeFt: 38e3, groundSpeedKts: 500 },
        { endFraction: 370 / 400, endAltitudeFt: 38e3, groundSpeedKts: 510 },
        { endFraction: 1, endAltitudeFt: 2500, groundSpeedKts: 250 }
      ],
      provenanceNote: "Reconstructed representative trajectory for a JFK-LHR Boeing 787-9 service departing at a different time than the primary demo flight, cruising higher (FL380 for most of the crossing). Same construction method and caveats as demo-jfk-lhr-b789 - see demo-data/README.md."
    });
  }
  function buildDemoFlightBosDub() {
    return buildFlight({
      id: "demo-bos-dub-a20n",
      callsign: "DEMO303",
      origin: { iata: "BOS", lat: 42.3656, lon: -71.0096 },
      destination: { iata: "DUB", lat: 53.4213, lon: -6.2701 },
      departureTime: "2026-01-14T23:40:00Z",
      aircraftIcaoType: "A20N",
      totalDurationSec: 340 * 60,
      samplingIntervalSec: 60,
      phases: [
        { endFraction: 24 / 340, endAltitudeFt: 34e3, groundSpeedKts: 320 },
        { endFraction: 160 / 340, endAltitudeFt: 34e3, groundSpeedKts: 470 },
        { endFraction: 165 / 340, endAltitudeFt: 36e3, groundSpeedKts: 470 },
        { endFraction: 300 / 340, endAltitudeFt: 36e3, groundSpeedKts: 480 },
        { endFraction: 1, endAltitudeFt: 2500, groundSpeedKts: 230 }
      ],
      provenanceNote: "Reconstructed representative trajectory for a Boston-Dublin A320neo service. Same construction method and caveats as demo-jfk-lhr-b789 - see demo-data/README.md."
    });
  }

  // src/browser-entry.ts
  var DEMO_FLIGHT_BUILDERS = {
    "demo-jfk-lhr-b789": buildDemoFlightJfkLhr,
    "demo-jfk-lhr-b789-clear": buildDemoFlightJfkLhrClearSkies,
    "demo-bos-dub-a20n": buildDemoFlightBosDub
  };
  async function analyzeDemoFlight(flightKey) {
    const flight = DEMO_FLIGHT_BUILDERS[flightKey]();
    const provider = new DemoDatasetProvider(flight.departureTime);
    return analyzeFlight(flight, provider);
  }
  globalThis.ContrailEngine = {
    analyzeDemoFlight,
    DEMO_FLIGHT_KEYS: Object.keys(DEMO_FLIGHT_BUILDERS)
  };
})();
