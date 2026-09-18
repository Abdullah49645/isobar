import { haversineMeters, hashNoise, isaTemperatureK } from "../utils/geo.js";
import type { AtmosphericSample } from "../models/flight.js";

/**
 * SYNTHETIC DEMO ATMOSPHERIC FIELD.
 *
 * This is NOT a weather model and NOT a re-run of CoCiP. It exists only
 * because this build environment has no outbound network access and no API
 * credentials, so neither the Google Contrails API nor the Contrails.org
 * CoCiP/ERA5 endpoints (see src/data/providers/googleContrailsProvider.ts)
 * can actually be called. Per the project spec (section 65: "do not
 * fabricate API output" for a *live* call, but *do* build a fallback so the
 * scientific workflow is still demonstrable), this module generates a
 * deterministic, physically-motivated stand-in field:
 *
 *  - Ambient temperature follows the real ICAO Standard Atmosphere lapse
 *    rate (src/utils/geo.ts:isaTemperatureK), perturbed by synthetic
 *    "moist-cold" weather patches.
 *  - Ice-supersaturated regions (ISSR) and the Schmidt-Appleman criterion
 *    (SAC) are computed from that temperature/humidity field using the same
 *    physical logic pycontrails uses (SAC: plume can reach liquid/ice
 *    saturation given ambient temperature; ISSR: ambient RHi > 100%) - see
 *    https://apidocs.contrails.org/notebooks/research_api.html
 *  - Energy-forcing magnitudes, when a persistent contrail is predicted, are
 *    drawn from the REAL documented CoCiP percentile distribution published
 *    at https://apidocs.contrails.org/ef-interpretation.html (including the
 *    documented ~35% net-cooling fraction), not an invented scale.
 *  - Everything is deterministic given (lat, lon, flightLevel, time) - no
 *    Math.random anywhere - so re-running the same flight always reproduces
 *    the same numbers (spec section 37).
 *
 * Every AtmosphericSample produced this way is tagged
 * `providerId: "demo-dataset"` and `confidence: "low"` or `"medium"`
 * (never `"high"`) specifically so the UI can never present it as if it
 * were live measured/forecast data. See demo-data/README.md.
 */

interface WeatherPatch {
  /** Patch center latitude at time t=0. */
  lat0: number;
  lon0: number;
  /** Linear drift, degrees per hour (crude but adequate for a demo). */
  latDriftPerHour: number;
  lonDriftPerHour: number;
  centerFlightLevel: number;
  verticalSigmaFl: number;
  horizontalSigmaKm: number;
  /** Reference time (ISO) this patch's lat0/lon0 apply to. */
  referenceTime: string;
  /** Peak moisture intensity in (0, ~1.3]; >1 allowed so cores clear ISSR threshold. */
  peakIntensity: number;
}

/** The real, documented CoCiP energy-forcing-per-flight-distance percentile table. */
const EF_PERCENTILE_TABLE: Array<[percentile: number, efPerMeterJ: number]> = [
  [1, -6.39e8],
  [5, -1.95e8],
  [10, -6.93e7],
  [15, -2.45e7],
  [20, -7.78e6],
  [25, -2.69e6],
  [30, -1.47e6],
  [35, -2.74e5],
  [40, 9.05e5],
  [45, 6.31e6],
  [50, 1.74e7],
  [55, 3.72e7],
  [60, 7.06e7],
  [65, 1.23e8],
  [70, 2.0e8],
  [75, 3.07e8],
  [80, 4.57e8],
  [85, 6.72e8],
  [90, 1.01e9],
  [95, 1.63e9],
  [99, 3.14e9],
];

function efPerMeterAtPercentile(percentile: number): number {
  const p = Math.max(1, Math.min(99, percentile));
  for (let i = 0; i < EF_PERCENTILE_TABLE.length - 1; i++) {
    const [p0, v0] = EF_PERCENTILE_TABLE[i]!;
    const [p1, v1] = EF_PERCENTILE_TABLE[i + 1]!;
    if (p >= p0 && p <= p1) {
      const t = (p - p0) / (p1 - p0);
      return v0 + t * (v1 - v0);
    }
  }
  return EF_PERCENTILE_TABLE[EF_PERCENTILE_TABLE.length - 1]![1];
}

export class SyntheticAtmosphericField {
  constructor(private readonly patches: WeatherPatch[]) {}

  private patchIntensityAt(
    lat: number,
    lon: number,
    flightLevel: number,
    timestamp: string,
  ): number {
    const t = new Date(timestamp).getTime();
    let total = 0;
    for (const patch of this.patches) {
      const refT = new Date(patch.referenceTime).getTime();
      const hoursElapsed = (t - refT) / 3_600_000;
      const centerLat = patch.lat0 + patch.latDriftPerHour * hoursElapsed;
      const centerLon = patch.lon0 + patch.lonDriftPerHour * hoursElapsed;

      const distKm = haversineMeters(lat, lon, centerLat, centerLon) / 1000;
      const horizontal = Math.exp(-(distKm ** 2) / (2 * patch.horizontalSigmaKm ** 2));

      const flDelta = flightLevel - patch.centerFlightLevel;
      const vertical = Math.exp(-(flDelta ** 2) / (2 * patch.verticalSigmaFl ** 2));

      total += patch.peakIntensity * horizontal * vertical;
    }
    return total;
  }

  sample(
    lat: number,
    lon: number,
    altitudeFt: number,
    timestamp: string,
  ): Omit<AtmosphericSample, "providerId"> {
    const flightLevel = Math.round(altitudeFt / 100 / 10) * 10; // nearest FL10 (hundreds of ft)
    const moistureIndex = this.patchIntensityAt(lat, lon, flightLevel, timestamp);

    const jitter = (hashNoise(lat * 100, lon * 100, flightLevel, new Date(timestamp).getTime() / 60000) - 0.5) * 0.06;
    const clampedMoisture = Math.max(0, Math.min(1.3, moistureIndex + jitter));

    const baseTempK = isaTemperatureK(altitudeFt);
    // Moist-cold patches run a few K colder than the ISA baseline - typical
    // of the upper-tropospheric ice-supersaturated layers CoCiP/ISSR target.
    const temperatureK = baseTempK - 3.5 * Math.min(1, clampedMoisture);

    const relativeHumidityIcePct = 28 + clampedMoisture * 95;

    // Schmidt-Appleman: at typical cruise flight levels over mid-latitudes,
    // ambient temperature is very often already cold enough for the exhaust
    // plume to reach liquid saturation - the rarer, selective condition is
    // persistence (ISSR), matching real CoCiP climatology where SAC is
    // satisfied far more often than persistent contrails actually occur.
    const sac: 0 | 1 = temperatureK < 235 ? 1 : 0;
    const issr: 0 | 1 = relativeHumidityIcePct > 100 ? 1 : 0;

    let persistentContrailProbability = 0;
    if (sac === 1) {
      // Smoothly ramp probability up as conditions move deeper into the
      // supersaturated core, rather than a hard 0/1 flip at RHi=100%.
      const margin = (relativeHumidityIcePct - 92) / 30;
      persistentContrailProbability = Math.max(0, Math.min(1, margin));
    }

    let segmentEnergyForcingJPerMeter: number | null = null;
    if (persistentContrailProbability > 0.05) {
      // Deterministic "severity roll" in [1,99], skewed toward higher
      // percentiles (more warming) the deeper into the patch we are - this
      // reproduces the documented fact that only a minority of
      // persistent-contrail waypoints (~65%) are net-warming outliers,
      // rather than forcing every persistent contrail to be a strong warmer.
      const roll = hashNoise(lat * 37, lon * 41, flightLevel * 3, new Date(timestamp).getTime() / 300000);
      const skew = 1 + 2.5 * persistentContrailProbability;
      const percentile = 100 * (1 - (1 - roll) ** skew);
      segmentEnergyForcingJPerMeter = efPerMeterAtPercentile(percentile);
    }

    const confidence: AtmosphericSample["confidence"] =
      clampedMoisture > 0.15 && clampedMoisture < 0.95 ? "low" : "medium";

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
      confidence,
    };
  }
}

/**
 * The demo dataset's default weather setup: two ISSR patches drifting along
 * the North Atlantic track, sized and timed so that a typical JFK-LHR
 * flight passes through one substantial encounter - enough to produce a
 * clear critical window without making the entire flight "critical" (which
 * would defeat the point of the localized-intervention feature).
 */
export function defaultNorthAtlanticPatches(referenceTime: string): WeatherPatch[] {
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
      peakIntensity: 1.15,
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
      peakIntensity: 0.55,
    },
  ];
}
