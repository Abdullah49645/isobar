import type { Flight, TrajectoryPoint } from "../models/flight.js";
import { AIRCRAFT_CATALOG } from "../models/aircraftCatalog.js";
import { greatCircleInterpolate, haversineMeters } from "../utils/geo.js";

/**
 * Demo flight trajectory construction.
 *
 * IMPORTANT / HONEST DISCLOSURE: this build environment has no outbound
 * network access, so we cannot pull real ADS-B telemetry from OpenSky for a
 * specific historical flight (OpenSky's historical interface additionally
 * requires an account and the Trino query interface for anything beyond a
 * live 30-day window - see src/data/providers/googleContrailsProvider.ts for
 * the equivalent disclosure on the atmospheric side).
 *
 * Instead, each demo flight below is a RECONSTRUCTED, REPRESENTATIVE
 * trajectory: a real city pair and real aircraft type, flown along the
 * great-circle route between them, with a realistic phase-of-flight profile
 * (climb, one or two operational step-climbs as the aircraft burns off fuel
 * and gets lighter, cruise, descent) built from publicly documented typical
 * airline operating patterns for that route and aircraft type - not litigated
 * against a specific tail number or specific day's actual radar track.
 *
 * Every Flight produced here carries
 * `dataProvenance.source === "reconstructed-representative"` specifically so
 * nothing downstream can present it as raw recorded telemetry. The
 * architecture (ContrailProvider, trajectory cleaning, etc.) is identical to
 * what a real OpenSky-backed flight would use - swapping in real historical
 * data later requires no changes to src/science or src/simulation.
 */

interface FlightPhase {
  /** Fraction of total flight duration where this phase ENDS (phases are consecutive). */
  endFraction: number;
  /** Altitude (ft) at the end of this phase. */
  endAltitudeFt: number;
  /** Representative ground speed (kts) during this phase, for distance integration. */
  groundSpeedKts: number;
}

interface DemoFlightSpec {
  id: string;
  callsign: string;
  origin: { iata: string; lat: number; lon: number };
  destination: { iata: string; lat: number; lon: number };
  departureTime: string;
  aircraftIcaoType: keyof typeof AIRCRAFT_CATALOG;
  totalDurationSec: number;
  phases: FlightPhase[];
  samplingIntervalSec: number;
  provenanceNote: string;
}

function buildTrajectory(spec: DemoFlightSpec): TrajectoryPoint[] {
  const { origin, destination, departureTime, totalDurationSec, phases, samplingIntervalSec } = spec;
  const depTimeMs = new Date(departureTime).getTime();
  const totalRouteDistanceM = haversineMeters(origin.lat, origin.lon, destination.lat, destination.lon);

  const stepCount = Math.floor(totalDurationSec / samplingIntervalSec) + 1;

  // First pass: integrate ground speed over time to get a raw (unnormalized)
  // cumulative-distance curve, and altitude at each step from the phase table.
  const rawDistances: number[] = [0];
  const altitudes: number[] = [];
  const speeds: number[] = [];

  let prevAltitudeFt = 0;
  let phaseStartFraction = 0;
  let phaseStartAltitudeFt = 0;

  for (let i = 0; i < stepCount; i++) {
    const tSec = i * samplingIntervalSec;
    const fraction = tSec / totalDurationSec;

    // Find current phase.
    let phase = phases[0]!;
    let cumulativeStart = 0;
    for (const p of phases) {
      if (fraction <= p.endFraction || p === phases[phases.length - 1]) {
        phase = p;
        break;
      }
      cumulativeStart = p.endFraction;
    }
    if (fraction > phaseStartFraction && phases.indexOf(phase) > 0) {
      // recompute phase start values based on previous phase's end
    }
    const phaseIndex = phases.indexOf(phase);
    const prevPhaseEndFraction = phaseIndex === 0 ? 0 : phases[phaseIndex - 1]!.endFraction;
    const prevPhaseEndAltitude = phaseIndex === 0 ? 0 : phases[phaseIndex - 1]!.endAltitudeFt;
    const phaseFraction =
      phase.endFraction > prevPhaseEndFraction
        ? (fraction - prevPhaseEndFraction) / (phase.endFraction - prevPhaseEndFraction)
        : 1;
    const clampedPhaseFraction = Math.max(0, Math.min(1, phaseFraction));

    // Smoothstep easing for altitude transitions (no instantaneous jumps in
    // the generated "raw" profile either, for the same physical-plausibility
    // reasons the counterfactual engine cares about).
    const eased = clampedPhaseFraction * clampedPhaseFraction * (3 - 2 * clampedPhaseFraction);
    const altitudeFt = prevPhaseEndAltitude + eased * (phase.endAltitudeFt - prevPhaseEndAltitude);

    altitudes.push(altitudeFt);
    speeds.push(phase.groundSpeedKts);
    prevAltitudeFt = altitudeFt;

    if (i > 0) {
      const dtSec = samplingIntervalSec;
      const avgSpeedKts = (speeds[i]! + speeds[i - 1]!) / 2;
      const distStepM = avgSpeedKts * 0.514444 * dtSec;
      rawDistances.push(rawDistances[i - 1]! + distStepM);
    }
  }
  void prevAltitudeFt;
  void phaseStartFraction;
  void phaseStartAltitudeFt;

  const rawTotal = rawDistances[rawDistances.length - 1]!;
  const scale = totalRouteDistanceM / rawTotal;

  const points: TrajectoryPoint[] = [];
  for (let i = 0; i < stepCount; i++) {
    const distanceFraction = (rawDistances[i]! * scale) / totalRouteDistanceM;
    const { latitude, longitude } = greatCircleInterpolate(
      origin.lat,
      origin.lon,
      destination.lat,
      destination.lon,
      Math.max(0, Math.min(1, distanceFraction)),
    );
    points.push({
      timestamp: new Date(depTimeMs + i * samplingIntervalSec * 1000).toISOString(),
      latitude,
      longitude,
      altitudeFt: Math.round(altitudes[i]!),
      groundSpeedKts: Math.round(speeds[i]!),
      interpolated: false,
      sourceResolutionSec: i < stepCount - 1 ? samplingIntervalSec : undefined,
    });
  }
  return points;
}

function buildFlight(spec: DemoFlightSpec): Flight {
  const trajectory = buildTrajectory(spec);
  const arrivalTime = trajectory[trajectory.length - 1]!.timestamp;
  return {
    id: spec.id,
    callsign: spec.callsign,
    origin: spec.origin.iata,
    destination: spec.destination.iata,
    departureTime: spec.departureTime,
    arrivalTime,
    aircraft: AIRCRAFT_CATALOG[spec.aircraftIcaoType]!,
    trajectory,
    dataProvenance: {
      source: "reconstructed-representative",
      note: spec.provenanceNote,
    },
  };
}

/**
 * Demo Flight A: strong contrail-sensitive encounter. JFK-LHR eastbound
 * 787-9, timed and routed to pass directly through the synthetic North
 * Atlantic ISSR patch (see src/science/atmosphericField.ts default patches)
 * during its FL360 cruise segment.
 */
export function buildDemoFlightJfkLhr(): Flight {
  return buildFlight({
    id: "demo-jfk-lhr-b789",
    callsign: "DEMO101",
    origin: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
    destination: { iata: "LHR", lat: 51.4700, lon: -0.4543 },
    departureTime: "2026-01-14T22:10:00Z", // overnight eastbound departure, typical for this route
    aircraftIcaoType: "B789",
    totalDurationSec: 410 * 60, // 6h50m, typical eastbound block time with jet-stream assist
    samplingIntervalSec: 60,
    phases: [
      { endFraction: 28 / 410, endAltitudeFt: 34000, groundSpeedKts: 340 }, // climb
      { endFraction: 150 / 410, endAltitudeFt: 34000, groundSpeedKts: 505 }, // cruise 1 (FL340)
      { endFraction: 155 / 410, endAltitudeFt: 36000, groundSpeedKts: 505 }, // step climb
      { endFraction: 280 / 410, endAltitudeFt: 36000, groundSpeedKts: 520 }, // cruise 2 (FL360) - through the patch
      { endFraction: 285 / 410, endAltitudeFt: 38000, groundSpeedKts: 520 }, // step climb
      { endFraction: 380 / 410, endAltitudeFt: 38000, groundSpeedKts: 500 }, // cruise 3 (FL380)
      { endFraction: 1, endAltitudeFt: 2500, groundSpeedKts: 250 }, // descent
    ],
    provenanceNote:
      "Reconstructed representative trajectory for a JFK-LHR Boeing 787-9 eastbound service: great-circle route between the two airports, with a phase-of-flight altitude/speed profile (climb, two operational step-climbs, cruise, descent) built from publicly documented typical operating patterns for this route and aircraft type. This is NOT a specific recorded flight's ADS-B telemetry - live historical retrieval from OpenSky requires network/account access unavailable in this build environment. See demo-data/README.md.",
  });
}

/**
 * Demo Flight B: weak/no meaningful contrail encounter. Same route and
 * aircraft, but timed so its cruise segment misses the synthetic ISSR
 * patches - demonstrating that not every flight has the same counterfactual
 * opportunity (spec section 31).
 */
export function buildDemoFlightJfkLhrClearSkies(): Flight {
  return buildFlight({
    id: "demo-jfk-lhr-b789-clear",
    callsign: "DEMO202",
    origin: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
    destination: { iata: "LHR", lat: 51.4700, lon: -0.4543 },
    departureTime: "2026-01-16T13:30:00Z", // different time of day / day -> patch has drifted past
    aircraftIcaoType: "B789",
    totalDurationSec: 400 * 60,
    samplingIntervalSec: 60,
    phases: [
      { endFraction: 28 / 400, endAltitudeFt: 34000, groundSpeedKts: 340 },
      { endFraction: 150 / 400, endAltitudeFt: 34000, groundSpeedKts: 500 },
      { endFraction: 155 / 400, endAltitudeFt: 38000, groundSpeedKts: 500 },
      { endFraction: 370 / 400, endAltitudeFt: 38000, groundSpeedKts: 510 },
      { endFraction: 1, endAltitudeFt: 2500, groundSpeedKts: 250 },
    ],
    provenanceNote:
      "Reconstructed representative trajectory for a JFK-LHR Boeing 787-9 service departing at a different time than the primary demo flight, cruising higher (FL380 for most of the crossing). Same construction method and caveats as demo-jfk-lhr-b789 - see demo-data/README.md.",
  });
}

/**
 * Demo Flight C: narrowbody transatlantic-adjacent case with an interesting
 * tradeoff - a shorter regional-scale flight where the counterfactual's
 * operational cost is proportionally more significant relative to the
 * flight's total fuel burn, illustrating that the "best" intervention isn't
 * always the same shape of answer.
 */
export function buildDemoFlightBosDub(): Flight {
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
      { endFraction: 24 / 340, endAltitudeFt: 34000, groundSpeedKts: 320 },
      { endFraction: 160 / 340, endAltitudeFt: 34000, groundSpeedKts: 470 },
      { endFraction: 165 / 340, endAltitudeFt: 36000, groundSpeedKts: 470 },
      { endFraction: 300 / 340, endAltitudeFt: 36000, groundSpeedKts: 480 },
      { endFraction: 1, endAltitudeFt: 2500, groundSpeedKts: 230 },
    ],
    provenanceNote:
      "Reconstructed representative trajectory for a Boston-Dublin A320neo service. Same construction method and caveats as demo-jfk-lhr-b789 - see demo-data/README.md.",
  });
}

export const DEMO_FLIGHT_BUILDERS = {
  "demo-jfk-lhr-b789": buildDemoFlightJfkLhr,
  "demo-jfk-lhr-b789-clear": buildDemoFlightJfkLhrClearSkies,
  "demo-bos-dub-a20n": buildDemoFlightBosDub,
} as const;
