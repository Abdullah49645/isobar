/**
 * Single entry point bundled (via esbuild) into a browser-ready IIFE for the
 * Isobar UI. Exposes the verified science/simulation engine on
 * `window.ContrailEngine` so the frontend can call `analyzeFlight()` live,
 * in-browser, exactly as scripts/precompute-demo-flights.ts does for the
 * offline validation/precompute path. No behavior in src/science or
 * src/simulation is modified for this — this file only wires existing,
 * tested exports together.
 */
import { analyzeFlight } from "./science/pipeline.js";
import { DemoDatasetProvider } from "./data/providers/demoDatasetProvider.js";
import {
  buildDemoFlightJfkLhr,
  buildDemoFlightJfkLhrClearSkies,
  buildDemoFlightBosDub,
} from "./data/demoFlights.js";

const DEMO_FLIGHT_BUILDERS = {
  "demo-jfk-lhr-b789": buildDemoFlightJfkLhr,
  "demo-jfk-lhr-b789-clear": buildDemoFlightJfkLhrClearSkies,
  "demo-bos-dub-a20n": buildDemoFlightBosDub,
};

async function analyzeDemoFlight(flightKey: keyof typeof DEMO_FLIGHT_BUILDERS) {
  const flight = DEMO_FLIGHT_BUILDERS[flightKey]();
  const provider = new DemoDatasetProvider(flight.departureTime);
  return analyzeFlight(flight, provider);
}

(globalThis as any).ContrailEngine = {
  analyzeDemoFlight,
  DEMO_FLIGHT_KEYS: Object.keys(DEMO_FLIGHT_BUILDERS),
};
