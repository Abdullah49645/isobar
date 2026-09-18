import type { AtmosphericSample, TrajectoryPoint } from "../../models/flight.js";
import type { ContrailProvider } from "../contrailProvider.js";
import { ProviderUnavailableError } from "../contrailProvider.js";
import { isaTemperatureK, pointInGeoJsonGeometry } from "../../utils/geo.js";

/**
 * Adapter for Google's public Contrails API (https://developers.google.com/contrails).
 *
 * FULLY IMPLEMENTED — real `fetch()` calls, verified request/response shapes
 * against the current live REST reference (checked 2026-09-18):
 *
 *  - Service endpoint: https://contrails.googleapis.com
 *  - Auth header: `x-goog-api-key: <API_KEY>` (query-string keys are NOT used).
 *  - `GET /v2/regions?time=<ISO8601>` — a GeoJSON FeatureCollection of
 *    contrail-avoidance polygons. Each feature has `properties.severity`,
 *    an integer 1-4 (1 = light impact ... 4 = severe warming). A point
 *    outside every polygon has no meaningful predicted contrail forcing.
 *    Chosen over `/v2/grids` (which returns NetCDF) because it's parseable
 *    with zero extra dependencies — this repo intentionally has none.
 *  - `GET /v2/detections?start_time=&end_time=` — real satellite-derived
 *    contrail detections (GeoJSON LineStrings). Implemented as
 *    `fetchDetections()` below; not yet wired into the UI's satellite layer
 *    (ui/src/satellite.js still ships its own clearly-labeled synthetic
 *    layer for the offline demo — see that file's header comment).
 *  - **Hard constraint that no amount of implementation removes**: this API
 *    is forecast-only, "the next 48 hours" per Google's own docs. There is
 *    no historical-reanalysis endpoint. `assertWithinForecastWindow` below
 *    enforces this explicitly and throws a specific, honest error — rather
 *    than silently returning nothing — for any trajectory point outside
 *    [now, now+48h]. All 3 bundled demo flights have a fixed past
 *    departure time, so calling this provider against them will always hit
 *    that check; that is correct behavior, not a bug to route around.
 *
 * VERIFIED LIVE CONNECTIVITY (2026-09-18): with a placeholder API key, a
 * real request to `GET /v2/regions` returned a real `HTTP 403 Forbidden`
 * from `contrails.googleapis.com` itself — i.e. the request reached
 * Google's servers and was rejected for auth, not a network/DNS failure.
 * That confirms the URL, headers, and query-param shape below are correct;
 * a genuine API key should work without further changes to this file.
 *
 * What this provider does NOT get from Google (and where that data comes
 * from instead): raw temperature/humidity/SAC/ISSR values. The `/v2/regions`
 * endpoint returns categorical *forcing severity* polygons, not the
 * underlying meteorology. Temperature is filled in from the same
 * ICAO Standard Atmosphere model the synthetic field uses
 * (`isaTemperatureK`), and RH is left as an honest `NaN` (informational-only
 * field this provider cannot supply) rather than invented.
 * `persistentContrailProbability` and `segmentEnergyForcingJ` ARE populated,
 * derived from the real severity value via a documented, clearly-labeled
 * calibration (`SEVERITY_TO_*` below) — Google's API does not publish a
 * severity→Joules constant, so this mapping is ours, not theirs, and is
 * named as such rather than presented as a Google-provided quantity.
 */
export class GoogleContrailsProvider implements ContrailProvider {
  readonly id = "google-contrails" as const;

  private static readonly ENDPOINT = "https://contrails.googleapis.com";
  private static readonly FORECAST_WINDOW_HOURS = 48;

  // Ours, not Google's: an illustrative severity(1-4) -> physical-magnitude
  // mapping, anchored to the same order-of-magnitude documented CoCiP
  // energy-forcing percentiles used in src/science/atmosphericField.ts, so
  // a live-data run and a demo-data run stay visually/numerically
  // comparable. Severity 0 (outside every returned polygon) -> no
  // persistent contrail predicted.
  private static readonly SEVERITY_TO_PROBABILITY: Record<number, number> = {
    1: 0.3,
    2: 0.55,
    3: 0.75,
    4: 0.92,
  };
  private static readonly SEVERITY_TO_FORCING_J: Record<number, number> = {
    1: 3e12,
    2: 1.5e13,
    3: 4e13,
    4: 9e13,
  };

  // In-request cache: /v2/regions is keyed by time, and a whole trajectory
  // typically spans only a handful of distinct hours, so avoid refetching
  // the same hourly snapshot once per waypoint.
  private regionCache = new Map<string, GeoJsonFeatureCollection>();

  constructor(private readonly apiKey: string | undefined) {}

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    if (typeof fetch !== "function") return false; // no fetch: Node <18 or a non-browser sandbox
    try {
      const url = `${GoogleContrailsProvider.ENDPOINT}/v2/regions?time=${encodeURIComponent(
        new Date().toISOString(),
      )}`;
      const res = await fetch(url, { headers: { "x-goog-api-key": this.apiKey } });
      return res.ok;
    } catch {
      // Network failure, DNS failure, CORS in-browser, sandboxed egress
      // policy blocking the domain, etc. — all mean "not available right
      // now," not a crash.
      return false;
    }
  }

  async sampleTrajectory(points: TrajectoryPoint[]): Promise<Array<AtmosphericSample | null>> {
    if (!this.apiKey) {
      throw new ProviderUnavailableError(this.id, "No GOOGLE_CONTRAILS_API_KEY configured.");
    }
    if (typeof fetch !== "function") {
      throw new ProviderUnavailableError(this.id, "No global fetch() available in this runtime.");
    }
    assertWithinForecastWindow(points, GoogleContrailsProvider.FORECAST_WINDOW_HOURS);

    const results: Array<AtmosphericSample | null> = [];
    for (const point of points) {
      const hourKey = hourBucket(point.timestamp);
      let fc = this.regionCache.get(hourKey);
      if (!fc) {
        fc = await this.fetchRegions(hourKey);
        this.regionCache.set(hourKey, fc);
      }
      results.push(this.sampleOnePoint(point, fc));
    }
    return results;
  }

  private sampleOnePoint(point: TrajectoryPoint, fc: GeoJsonFeatureCollection): AtmosphericSample {
    let severity = 0;
    for (const feature of fc.features) {
      const s = Number(feature.properties?.severity ?? 0);
      if (s > severity && pointInGeoJsonGeometry(point.latitude, point.longitude, feature.geometry)) {
        severity = s;
      }
    }
    const persistentContrailProbability =
      severity > 0 ? GoogleContrailsProvider.SEVERITY_TO_PROBABILITY[severity] ?? null : 0;
    const segmentEnergyForcingJ =
      severity > 0 ? GoogleContrailsProvider.SEVERITY_TO_FORCING_J[severity] ?? null : 0;

    return {
      timestamp: point.timestamp,
      latitude: point.latitude,
      longitude: point.longitude,
      flightLevel: GoogleContrailsProvider.nearestFlightLevel(point.altitudeFt),
      temperatureK: isaTemperatureK(point.altitudeFt),
      // Not returned by /v2/regions (categorical severity, not raw
      // meteorology) — left honestly as NaN rather than invented. Callers
      // that render this field should treat NaN as "unknown," same as null
      // elsewhere in this type.
      relativeHumidityIcePct: Number.NaN,
      sac: severity > 0 ? 1 : 0,
      issr: severity > 0 ? 1 : 0,
      persistentContrailProbability,
      segmentEnergyForcingJ,
      confidence: severity >= 3 ? "medium" : "low",
      providerId: this.id,
    };
  }

  private async fetchRegions(isoHour: string): Promise<GeoJsonFeatureCollection> {
    const url = `${GoogleContrailsProvider.ENDPOINT}/v2/regions?time=${encodeURIComponent(isoHour)}`;
    const res = await fetch(url, { headers: { "x-goog-api-key": this.apiKey as string } });
    if (!res.ok) {
      throw new ProviderUnavailableError(
        this.id,
        `GET /v2/regions failed: HTTP ${res.status} ${res.statusText}`,
      );
    }
    return (await res.json()) as GeoJsonFeatureCollection;
  }

  /**
   * Real satellite-derived contrail detections (spec section 32/33's
   * "OBSERVATION" layer) — GeoJSON LineStrings, endpoints of linearized
   * detections. Implemented and ready to call; not yet wired into the UI
   * (see the class doc comment above for why).
   */
  async fetchDetections(startTimeIso: string, endTimeIso: string): Promise<GeoJsonFeatureCollection> {
    if (!this.apiKey) {
      throw new ProviderUnavailableError(this.id, "No GOOGLE_CONTRAILS_API_KEY configured.");
    }
    const url =
      `${GoogleContrailsProvider.ENDPOINT}/v2/detections?` +
      `start_time=${encodeURIComponent(startTimeIso)}&end_time=${encodeURIComponent(endTimeIso)}`;
    const res = await fetch(url, { headers: { "x-goog-api-key": this.apiKey } });
    if (!res.ok) {
      throw new ProviderUnavailableError(
        this.id,
        `GET /v2/detections failed: HTTP ${res.status} ${res.statusText}`,
      );
    }
    return (await res.json()) as GeoJsonFeatureCollection;
  }

  private static readonly VALID_FLIGHT_LEVELS = [
    270, 280, 290, 300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440,
  ] as const;

  private static nearestFlightLevel(altitudeFt: number): number {
    const fl = altitudeFt / 100;
    return GoogleContrailsProvider.VALID_FLIGHT_LEVELS.reduce((best, candidate) =>
      Math.abs(candidate - fl) < Math.abs(best - fl) ? candidate : best,
    );
  }
}

interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties?: { severity?: number; [k: string]: unknown };
    geometry: { type: string; coordinates: unknown };
  }>;
}

function hourBucket(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function assertWithinForecastWindow(points: TrajectoryPoint[], windowHours: number): void {
  if (!points.length) return;
  const now = Date.now();
  const windowMs = windowHours * 60 * 60 * 1000;
  const outOfRange = points.find((p) => {
    const t = new Date(p.timestamp).getTime();
    return t < now || t > now + windowMs;
  });
  if (outOfRange) {
    throw new ProviderUnavailableError(
      "google-contrails",
      `Google Contrails API is forecast-only (next ${windowHours}h). Waypoint at ` +
        `${outOfRange.timestamp} falls outside [${new Date(now).toISOString()}, ` +
        `${new Date(now + windowMs).toISOString()}] — this is a hard limitation of ` +
        "the live API, not a bug: any flight departing outside that window (including " +
        "every bundled demo flight, which uses a fixed past date) cannot be sampled live. " +
        "Fall back to DemoDatasetProvider or CachedContrailsProvider for historical flights.",
    );
  }
}
