import { test } from "node:test";
import assert from "node:assert/strict";
import { GoogleContrailsProvider } from "../providers/googleContrailsProvider.js";
import { ProviderUnavailableError } from "../contrailProvider.js";
import type { TrajectoryPoint } from "../../models/flight.js";

test("GoogleContrailsProvider.isAvailable: false with no API key configured (no network call made)", async () => {
  const provider = new GoogleContrailsProvider(undefined);
  assert.equal(await provider.isAvailable(), false);
});

test("GoogleContrailsProvider.sampleTrajectory: throws ProviderUnavailableError with no API key, naming the missing key", async () => {
  const provider = new GoogleContrailsProvider(undefined);
  await assert.rejects(
    () => provider.sampleTrajectory([]),
    (err: unknown) => {
      assert.ok(err instanceof ProviderUnavailableError);
      assert.match((err as Error).message, /GOOGLE_CONTRAILS_API_KEY/);
      return true;
    },
  );
});

test("GoogleContrailsProvider.sampleTrajectory: throws a specific forecast-window error for a point in the past, before any network call", async () => {
  const provider = new GoogleContrailsProvider("fake-key-for-guard-test-only");
  const pastPoint: TrajectoryPoint = {
    timestamp: "2020-01-01T00:00:00.000Z",
    latitude: 40.64,
    longitude: -73.78,
    altitudeFt: 36000,
    interpolated: false,
  };
  await assert.rejects(
    () => provider.sampleTrajectory([pastPoint]),
    (err: unknown) => {
      assert.ok(err instanceof ProviderUnavailableError);
      assert.match((err as Error).message, /forecast-only/);
      assert.match((err as Error).message, /48h/);
      return true;
    },
  );
});

test("GoogleContrailsProvider.sampleTrajectory: throws the same forecast-window error for a point too far in the future (past 48h)", async () => {
  const provider = new GoogleContrailsProvider("fake-key-for-guard-test-only");
  const farFuturePoint: TrajectoryPoint = {
    timestamp: new Date(Date.now() + 1000 * 60 * 60 * 200).toISOString(), // +200h
    latitude: 40.64,
    longitude: -73.78,
    altitudeFt: 36000,
    interpolated: false,
  };
  await assert.rejects(
    () => provider.sampleTrajectory([farFuturePoint]),
    (err: unknown) => {
      assert.ok(err instanceof ProviderUnavailableError);
      assert.match((err as Error).message, /forecast-only/);
      return true;
    },
  );
});

test("GoogleContrailsProvider.fetchDetections: throws ProviderUnavailableError with no API key (no network call made)", async () => {
  const provider = new GoogleContrailsProvider(undefined);
  await assert.rejects(
    () => provider.fetchDetections("2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"),
    (err: unknown) => {
      assert.ok(err instanceof ProviderUnavailableError);
      return true;
    },
  );
});
