import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenSkyClient } from "../providers/openSkyClient.js";
import { ProviderUnavailableError } from "../contrailProvider.js";

test("OpenSkyClient.isConfigured: false when either credential is missing", () => {
  assert.equal(new OpenSkyClient(undefined, undefined).isConfigured(), false);
  assert.equal(new OpenSkyClient("id-only", undefined).isConfigured(), false);
  assert.equal(new OpenSkyClient(undefined, "secret-only").isConfigured(), false);
});

test("OpenSkyClient.isConfigured: true when both credentials are present", () => {
  assert.equal(new OpenSkyClient("id", "secret").isConfigured(), true);
});

test("OpenSkyClient.findFlightsByDepartureAirport: throws ProviderUnavailableError with no credentials (no network call made)", async () => {
  const client = new OpenSkyClient(undefined, undefined);
  await assert.rejects(
    () => client.findFlightsByDepartureAirport("KJFK", 0, 3600),
    (err: unknown) => {
      assert.ok(err instanceof ProviderUnavailableError);
      assert.match((err as Error).message, /OPENSKY_CLIENT_ID/);
      return true;
    },
  );
});

test("OpenSkyClient.getTrack: throws ProviderUnavailableError with no credentials (no network call made)", async () => {
  const client = new OpenSkyClient(undefined, undefined);
  await assert.rejects(
    () => client.getTrack("abc123", 0),
    (err: unknown) => err instanceof ProviderUnavailableError,
  );
});

test("OpenSkyClient.loadHistoricalFlight: throws ProviderUnavailableError with no credentials (no network call made)", async () => {
  const client = new OpenSkyClient(undefined, undefined);
  await assert.rejects(
    () => client.loadHistoricalFlight("abc123", 0),
    (err: unknown) => err instanceof ProviderUnavailableError,
  );
});
