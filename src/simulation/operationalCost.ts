import type { AircraftModel, TrajectoryPoint } from "../models/flight.js";
import { JET_FUEL_CO2_FACTOR_KG_PER_KG, TYPICAL_CRUISE_FUEL_FLOW_KG_PER_HOUR } from "../models/aircraftCatalog.js";
import { isaTemperatureK } from "../utils/geo.js";

/**
 * Simplified operational-cost model. Explicitly NOT an aircraft
 * type-certificate performance model (spec section 16: "NEVER pretend that
 * our fuel estimates are exact"). Two effects are modeled, each individually
 * transparent and citable:
 *
 * 1. FUEL: cruising away from the actual historical altitude is treated as a
 *    parabolic fuel-flow penalty. We assume the flight's *actual* recorded
 *    cruise altitude was operationally close to that flight's optimum
 *    (airlines choose cruise levels substantially to minimize trip cost,
 *    including fuel), so a counterfactual altitude offset is treated as a
 *    displacement from that operating point in either direction. The
 *    magnitude of the parabola is calibrated to commonly-cited rule-of-thumb
 *    penalties (roughly 0.5-1% extra fuel flow per 1,000 ft away from
 *    optimum at typical long-haul cruise weights) - NOT derived from a
 *    manufacturer performance table. A production system would replace this
 *    with a real performance model such as OpenAP
 *    (https://github.com/junzis/openap, Sun et al. 2020).
 *
 * 2. TIME: cruising at a different altitude changes true airspeed for a
 *    pilot holding a constant cruise Mach number (standard airline
 *    procedure). Speed of sound depends on ambient temperature, which
 *    follows the ICAO Standard Atmosphere lapse rate up to the tropopause
 *    (src/utils/geo.ts:isaTemperatureK). We hold Mach constant, recompute
 *    true airspeed at the new altitude, and integrate the resulting time
 *    change over the affected segment. Wind is NOT modeled - an explicit,
 *    documented simplification.
 */

const FUEL_PENALTY_K_PER_1000FT_SQUARED = 0.006; // fuel-flow fraction increase per (1000 ft offset)^2
const GAMMA_AIR = 1.4;
const R_SPECIFIC_AIR = 287.05; // J/(kg*K)

function speedOfSoundMs(temperatureK: number): number {
  return Math.sqrt(GAMMA_AIR * R_SPECIFIC_AIR * temperatureK);
}

export interface OperationalCostResult {
  fuelDeltaKg: number;
  co2DeltaKg: number;
  timeDeltaSec: number;
  assumptions: string[];
}

export function estimateOperationalCost(
  baseline: TrajectoryPoint[],
  counterfactual: TrajectoryPoint[],
  aircraft: AircraftModel,
): OperationalCostResult {
  if (baseline.length !== counterfactual.length) {
    throw new Error("baseline and counterfactual trajectories must have matching waypoint counts");
  }

  const baseFuelFlowKgPerSec = TYPICAL_CRUISE_FUEL_FLOW_KG_PER_HOUR[aircraft.aircraftClass] / 3600;

  let fuelDeltaKg = 0;
  let timeDeltaSec = 0;

  for (let i = 0; i < baseline.length - 1; i++) {
    const b0 = baseline[i]!;
    const b1 = baseline[i + 1]!;
    const c0 = counterfactual[i]!;
    const c1 = counterfactual[i + 1]!;

    const dtSec = (new Date(b1.timestamp).getTime() - new Date(b0.timestamp).getTime()) / 1000;
    if (dtSec <= 0) continue;

    const offsetFt = ((c0.altitudeFt - b0.altitudeFt) + (c1.altitudeFt - b1.altitudeFt)) / 2;
    if (offsetFt === 0) continue;

    // --- Fuel effect ---
    const penaltyFraction = FUEL_PENALTY_K_PER_1000FT_SQUARED * (offsetFt / 1000) ** 2;
    fuelDeltaKg += baseFuelFlowKgPerSec * dtSec * penaltyFraction;

    // --- Time effect (constant-Mach altitude change) ---
    const baseTasKts = b0.groundSpeedKts ?? aircraft.typicalCruiseTasKts;
    const baseTempK = isaTemperatureK(b0.altitudeFt);
    const newTempK = isaTemperatureK(c0.altitudeFt);
    const mach = (baseTasKts * 0.514444) / speedOfSoundMs(baseTempK); // kts -> m/s
    const newTasMs = mach * speedOfSoundMs(newTempK);
    const newTasKts = newTasMs / 0.514444;

    if (newTasKts > 0) {
      const segmentDistanceNm = (baseTasKts * dtSec) / 3600;
      const baseSegTimeSec = dtSec;
      const newSegTimeSec = (segmentDistanceNm / newTasKts) * 3600;
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
      `CO2 delta uses the standard ${JET_FUEL_CO2_FACTOR_KG_PER_KG} kg CO2 per kg jet fuel combustion factor.`,
    ],
  };
}
