/**
 * Local server for running Isobar WITH the real API keys actually pinging
 * Google Contrails / OpenSky — not the static ui/dist/index.html, which is
 * demo-only by design (see README § "why not in the browser").
 *
 * Run: npm run serve:live   (reads .env itself, no --env-file flag needed)
 *
 * Serves:
 *   GET /                                      -> ui/dist/index.html (demo mode)
 *   GET /api/opensky/search?airport=KJFK        -> real recent departures from that airport
 *   GET /api/opensky/analyze?icao24=&time=      -> real OpenSky track, run through the SAME
 *                                                   analyzeFlight() pipeline as demo mode
 *                                                   (real trajectory + synthetic atmosphere,
 *                                                   since Google's API can't do history — see
 *                                                   README). Returns a full FlightAnalysis JSON.
 *   GET /api/google/check?lat=&lon=&alt=&time=  -> a real, live Google Contrails /v2/regions
 *                                                   sample at one point (time must be within
 *                                                   the next 48h — forecast-only, see README)
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { OpenSkyClient } from "./src/data/providers/openSkyClient.js";
import { GoogleContrailsProvider } from "./src/data/providers/googleContrailsProvider.js";
import { DemoDatasetProvider } from "./src/data/providers/demoDatasetProvider.js";
import { analyzeFlight } from "./src/science/pipeline.js";

loadDotEnv();

const PORT = Number(process.env.PORT) || 8787;
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = join(__dirname, "ui", "dist");

const opensky = new OpenSkyClient(process.env.OPENSKY_CLIENT_ID, process.env.OPENSKY_CLIENT_SECRET);
const google = new GoogleContrailsProvider(process.env.GOOGLE_CONTRAILS_API_KEY);

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    if (url.pathname === "/api/opensky/search") return await handleOpenSkySearch(url, res);
    if (url.pathname === "/api/opensky/analyze") return await handleOpenSkyAnalyze(url, res);
    if (url.pathname === "/api/google/check") return await handleGoogleCheck(url, res);
    return serveStatic(url.pathname, res);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: (err as Error).message, name: (err as Error).name }, null, 2));
  }
});

async function handleOpenSkySearch(url: URL, res: import("node:http").ServerResponse) {
  if (!opensky.isConfigured()) return sendJson(res, 400, { error: "OPENSKY_CLIENT_ID/SECRET not set in .env" });
  const airport = url.searchParams.get("airport") ?? "KJFK";
  const hours = Number(url.searchParams.get("hours") ?? 3);
  const end = Math.floor(Date.now() / 1000);
  const begin = end - hours * 3600;
  console.log(`[opensky] real request: departures from ${airport}, last ${hours}h`);
  const flights = await opensky.findFlightsByDepartureAirport(airport, begin, end);
  sendJson(res, 200, { airport, begin, end, count: flights.length, flights });
}

async function handleOpenSkyAnalyze(url: URL, res: import("node:http").ServerResponse) {
  if (!opensky.isConfigured()) return sendJson(res, 400, { error: "OPENSKY_CLIENT_ID/SECRET not set in .env" });
  const icao24 = url.searchParams.get("icao24");
  const time = Number(url.searchParams.get("time"));
  if (!icao24 || !time) return sendJson(res, 400, { error: "?icao24=<hex>&time=<unix> required" });
  console.log(`[opensky] real request: track for icao24=${icao24} time=${time}`);
  const flight = await opensky.loadHistoricalFlight(icao24, time, {
    origin: url.searchParams.get("origin") ?? undefined,
    destination: url.searchParams.get("destination") ?? undefined,
  });
  // Real trajectory, synthetic atmosphere (Google's API is forecast-only and
  // can't sample a past flight — see README). Same pipeline as demo mode.
  const provider = new DemoDatasetProvider(flight.departureTime);
  const analysis = await analyzeFlight(flight, provider);
  sendJson(res, 200, analysis);
}

async function handleGoogleCheck(url: URL, res: import("node:http").ServerResponse) {
  const key = process.env.GOOGLE_CONTRAILS_API_KEY;
  if (!key) return sendJson(res, 400, { error: "GOOGLE_CONTRAILS_API_KEY not set in .env" });
  const lat = Number(url.searchParams.get("lat") ?? 51);
  const lon = Number(url.searchParams.get("lon") ?? -20);
  const alt = Number(url.searchParams.get("alt") ?? 36000);
  const timeParam = url.searchParams.get("time");
  const timestamp = timeParam ?? new Date(Date.now() + 3600_000).toISOString();
  console.log(`[google] real request: /v2/regions sample at ${lat},${lon} FL${Math.round(alt / 100)} @ ${timestamp}`);
  console.log(`[google] isAvailable() -> checking real connectivity to contrails.googleapis.com...`);
  const available = await google.isAvailable();
  const samples = await google.sampleTrajectory([
    { timestamp, latitude: lat, longitude: lon, altitudeFt: alt, interpolated: false },
  ]);
  sendJson(res, 200, { available, query: { lat, lon, alt, timestamp }, sample: samples[0] });
}

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

function serveStatic(pathname: string, res: import("node:http").ServerResponse) {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = join(DIST_DIR, rel);
  if (!existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found. Did you run `npm run build:ui` first?");
    return;
  }
  const ext = extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
  res.end(readFileSync(filePath));
}

function loadDotEnv() {
  const envPath = join(fileURLToPath(new URL(".", import.meta.url)), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

server.listen(PORT, () => {
  console.log(`\nIsobar local server: http://localhost:${PORT}`);
  console.log(`  demo app:        http://localhost:${PORT}/`);
  console.log(`  OpenSky search:  http://localhost:${PORT}/api/opensky/search?airport=KJFK`);
  console.log(`  OpenSky analyze: http://localhost:${PORT}/api/opensky/analyze?icao24=<hex>&time=<unix>`);
  console.log(`  Google check:    http://localhost:${PORT}/api/google/check`);
  console.log(`  OpenSky configured: ${opensky.isConfigured()}`);
  console.log(`  Google key set:     ${!!process.env.GOOGLE_CONTRAILS_API_KEY}\n`);
});
