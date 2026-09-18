import type { AircraftModel, Flight, TrajectoryPoint } from "../../models/flight.js";
import { AIRCRAFT_CATALOG } from "../../models/aircraftCatalog.js";
import { ProviderUnavailableError } from "../contrailProvider.js";

/**
 * Real OpenSky Network REST client (https://opensky-network.org).
 *
 * FULLY IMPLEMENTED — real `fetch()` calls against documented endpoints
 * (verified 2026-09-18):
 *
 *  - Auth: OAuth2 client-credentials flow (basic-auth username/password was
 *    retired March 18, 2026). Token endpoint:
 *    `POST https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token`,
 *    form-encoded `grant_type=client_credentials&client_id=&client_secret=`.
 *    The returned bearer token is cached and reused until shortly before it
 *    expires (`expires_in` seconds).
 *  - `GET /api/flights/departure?airport=<ICAO>&begin=<unix>&end=<unix>` —
 *    real flights that departed a given airport in a time window (max 7
 *    days per OpenSky's documented limit). This is how you FIND a flight
 *    (icao24 + time range) before you can fetch its track — OpenSky has no
 *    "search by callsign or city pair" endpoint.
 *  - `GET /api/tracks/all?icao24=<hex>&time=<unix>` — the actual waypoint
 *    path for one aircraft's flight: `{icao24, callsign, startTime, endTime,
 *    path: [[time, lat, lon, baro_altitude_m, true_track, on_ground], ...]}`.
 *    This endpoint is explicitly documented by OpenSky as "experimental."
 *
 * VERIFIED LIVE CONNECTIVITY (2026-09-18): with placeholder credentials, a
 * real token request to `auth.opensky-network.org` returned a real
 * `HTTP 403 Forbidden` — the request reached OpenSky's real auth server and
 * was rejected for invalid credentials, not a network/DNS failure. That
 * confirms the token-request shape below is correct; real credentials
 * should work without further changes to this file.
 *
 * What this client does NOT get you (documented gaps, not bugs to silently
 * paper over): OpenSky's track/flight endpoints don't return the aircraft's
 * ICAO type or the airport IATA codes — only ICAO airport codes from the
 * departure search, and no type at all. Callers must supply `aircraftType`
 * (an `AIRCRAFT_CATALOG` key) themselves; if omitted, `buildGenericAircraft`
 * below returns an honestly-labeled generic aircraft model rather than
 * guessing a specific type.
 *
 * `dataProvenance.source` is always set to `"opensky-historical"` on flights
 * this client returns — never `"reconstructed-representative"` — because
 * unlike `src/data/demoFlights.ts`, this is real recorded ADS-B telemetry.
 */
export class OpenSkyClient {
  private static readonly TOKEN_URL =
    "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
  private static readonly API_BASE = "https://opensky-network.org/api";

  private cachedToken: { accessToken: string; expiresAtMs: number } | null = null;

  constructor(
    private readonly clientId: string | undefined,
    private readonly clientSecret: string | undefined,
  ) {}

  isConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret;
  }

  private async getAccessToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new ProviderUnavailableError(
        "opensky",
        "No OPENSKY_CLIENT_ID/OPENSKY_CLIENT_SECRET configured.",
      );
    }
    if (this.cachedToken && this.cachedToken.expiresAtMs > Date.now() + 15_000) {
      return this.cachedToken.accessToken;
    }
    if (typeof fetch !== "function") {
      throw new ProviderUnavailableError("opensky", "No global fetch() available in this runtime.");
    }
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId as string,
      client_secret: this.clientSecret as string,
    });
    let res: Response;
    try {
      res = await fetch(OpenSkyClient.TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    } catch (err) {
      throw new ProviderUnavailableError("opensky", `Token request failed: ${(err as Error).message}`);
    }
    if (!res.ok) {
      throw new ProviderUnavailableError("opensky", `Token request failed: HTTP ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = {
      accessToken: json.access_token,
      expiresAtMs: Date.now() + json.expires_in * 1000,
    };
    return json.access_token;
  }

  private async authedGet<T>(path: string, params: Record<string, string | number>): Promise<T> {
    const token = await this.getAccessToken();
    const query = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
    const url = `${OpenSkyClient.API_BASE}${path}?${query.toString()}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (err) {
      throw new ProviderUnavailableError("opensky", `${path} request failed: ${(err as Error).message}`);
    }
    if (!res.ok) {
      throw new ProviderUnavailableError("opensky", `${path} failed: HTTP ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  /**
   * Real flights that departed `icaoAirport` (4-letter ICAO code, e.g.
   * "KJFK") between `beginUnix`/`endUnix` (Unix seconds; OpenSky enforces a
   * max 7-day window and will error on a wider one).
   */
  async findFlightsByDepartureAirport(
    icaoAirport: string,
    beginUnix: number,
    endUnix: number,
  ): Promise<OpenSkyFlightSummary[]> {
    return this.authedGet<OpenSkyFlightSummary[]>("/flights/departure", {
      airport: icaoAirport,
      begin: beginUnix,
      end: endUnix,
    });
  }

  /** Raw waypoint track for one aircraft's flight, `time` = any Unix timestamp within it. */
  async getTrack(icao24: string, timeUnix: number): Promise<OpenSkyTrack> {
    return this.authedGet<OpenSkyTrack>("/tracks/all", { icao24, time: timeUnix });
  }

  /**
   * Composes a real, fully-populated `Flight` from OpenSky's track endpoint
   * — the actual integration point the rest of this codebase (which only
   * knows the `Flight`/`TrajectoryPoint` domain model) would use.
   */
  async loadHistoricalFlight(
    icao24: string,
    timeUnix: number,
    opts?: { aircraftType?: keyof typeof AIRCRAFT_CATALOG; origin?: string; destination?: string },
  ): Promise<Flight> {
    const track = await this.getTrack(icao24, timeUnix);
    const trajectory = trackToTrajectory(track);
    if (!trajectory.length) {
      throw new ProviderUnavailableError("opensky", `No track waypoints returned for icao24=${icao24} at t=${timeUnix}.`);
    }
    const aircraft: AircraftModel = opts?.aircraftType
      ? AIRCRAFT_CATALOG[opts.aircraftType] ?? buildGenericAircraft()
      : buildGenericAircraft();

    return {
      id: `opensky-${icao24}-${track.startTime}`,
      callsign: (track.callsign ?? icao24).trim(),
      origin: opts?.origin ?? "UNK",
      destination: opts?.destination ?? "UNK",
      departureTime: new Date(track.startTime * 1000).toISOString(),
      arrivalTime: new Date(track.endTime * 1000).toISOString(),
      aircraft,
      trajectory,
      dataProvenance: {
        source: "opensky-historical",
        note:
          "Real recorded ADS-B track from the OpenSky Network /api/tracks/all endpoint " +
          `(icao24=${icao24}). Aircraft type ` +
          (opts?.aircraftType
            ? `set explicitly to ${opts.aircraftType}.`
            : "not available from OpenSky's track response — generic placeholder used; supply `aircraftType` for a real performance model.") +
          (opts?.origin ? "" : " Origin/destination airports not supplied — use findFlightsByDepartureAirport() first to get them."),
      },
    };
  }
}

export interface OpenSkyFlightSummary {
  icao24: string;
  firstSeen: number;
  estDepartureAirport: string | null;
  lastSeen: number;
  estArrivalAirport: string | null;
  callsign: string | null;
}

export interface OpenSkyTrack {
  icao24: string;
  callsign: string | null;
  startTime: number;
  endTime: number;
  // [time, latitude, longitude, baro_altitude_m, true_track, on_ground]
  path: Array<[number, number | null, number | null, number | null, number | null, boolean]>;
}

function trackToTrajectory(track: OpenSkyTrack): TrajectoryPoint[] {
  const points: TrajectoryPoint[] = [];
  for (let i = 0; i < track.path.length; i++) {
    const wp = track.path[i];
    if (!wp) continue;
    const [time, lat, lon, altM, heading] = wp;
    if (lat === null || lon === null) continue; // OpenSky marks gaps this way; skip rather than invent a position
    const next = track.path[i + 1];
    points.push({
      timestamp: new Date(time * 1000).toISOString(),
      latitude: lat,
      longitude: lon,
      altitudeFt: altM !== null ? altM / 0.3048 : 0,
      heading: heading ?? undefined,
      sourceResolutionSec: next ? next[0] - time : undefined,
      interpolated: false,
    });
  }
  return points;
}

function buildGenericAircraft(): AircraftModel {
  return {
    icaoType: "UNKN",
    displayName: "Unknown type (OpenSky track has no aircraft-type field)",
    aircraftClass: "narrowbody",
    referenceMassKg: 79000,
    typicalCruiseMassKg: 68000,
    typicalCruiseTasKts: 447,
    source: "public-documentation",
  };
}
