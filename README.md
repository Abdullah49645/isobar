# Isobar

**Counterfactual flight planning for reducing aviation's contrail climate impact.**

> Built for the [TechCommons V2 Hackathon](https://techcommons-hacks-v2.devpost.com/?ref_feature=challenge&ref_medium=your-open-hackathons&ref_content=Submissions+open).

What if a small change in a flight's trajectory could substantially reduce its modeled contrail

climate impact — and what would that change actually cost?

`node --test` 60/60 engine + provider tests · 29/29 UI-logic tests · TypeScript strict mode ·

zero LLM calls anywhere in the computation path

Isobar is a counterfactual flight-analysis engine that replays real flight trajectories,

identifies the atmospheric regions where persistent contrails are more likely to form, generates

physically constrained alternative flight profiles, and quantifies the tradeoff between modeled

climate impact and operational cost — interactively, in a 2D radar scope or a 3D globe, entirely

offline.

**[Quick start](#quick-start)** · **[The optimization problem](#the-optimization-problem)** ·

**[Pipeline](#how-it-works-the-simulation-pipeline)** · **[Data sources & API integration](#data-sources--api-integration)** ·

**[Architecture](#architecture)** · **[Roadmap](#whats-next)**

---

## Why this matters

Aviation warms the planet through more than CO₂. When an aircraft flies through a cold, humid
air mass — an **Ice Supersaturated Region (ISSR)** — water vapor condenses and freezes around
exhaust soot and forms a **persistent contrail**: an artificial cirrus cloud that traps outgoing
terrestrial heat. Per flight, that effect can rival or exceed the flight's own CO₂ forcing, and
unlike CO₂ it doesn't accumulate for centuries — it's gone within hours of the flight landing.

That also makes it unusually *actionable*. A contrail's formation depends on the aircraft's exact
4D trajectory (latitude, longitude, altitude, time) relative to a thin, localized ISSR layer.
Often the aircraft doesn't need to be rerouted at all — a **1,000–2,000 ft altitude change**
for a few minutes is enough to exit the layer and avoid the contrail entirely.

That intervention isn't free, though. Commercial flights are planned to cruise near their
fuel-optimal altitude; deviating from it costs fuel, CO₂, and time, and adds operational
complexity for ATC. Minimizing contrail impact in isolation isn't the goal — the goal is to make
the tradeoff **measurable**:

$$
\Delta\text{NetImpact} = f(\Delta\text{ContrailForcing}) - g(\Delta CO_2,\ \Delta\text{Fuel},\ \Delta\text{Time})
$$

Isobar doesn't try to collapse that into one score or dictate a single "correct" trajectory.
Instead it generates the feasible alternative-trajectory space and exposes the **Pareto
frontier** — every alternative that isn't strictly dominated by a cheaper-and-better one — so the
climate benefit of an intervention can be weighed directly against its operational cost.

---

## What this is not

- Not a generic flight tracker.
- Not an "AI predicts contrails" app — there is no LLM anywhere in the computation path.
- Not a claim to have invented contrail avoidance — that's active, real research and operational
  work elsewhere (pycontrails/CoCiP, Google's Contrails API — see below).
- Not suitable for real-world flight dispatch or pilot decision-making. Every number this
  project produces is a modeled estimate, not a measurement.

---

## How it works: the simulation pipeline

Isobar processes a flight through eight stages, from raw trajectory to Pareto-ranked
alternatives:

1. **Trajectory normalization** (`src/science/trajectory.ts`) — sorts by time, drops exact
   duplicates, and **flags** (never silently deletes) physically impossible ground-speed jumps.
   Every point is tagged `interpolated: true/false` so downstream science never operates on an
   invented position.
2. **Atmospheric reconstruction** (`src/science/atmosphericField.ts`) — samples temperature,
   humidity, and ISSR boundaries along the normalized path using a real ICAO Standard Atmosphere
   temperature model and Schmidt-Appleman / ISSR logic.
3. **Contrail formation modeling** — applies that atmospheric field against the flight's own
   trajectory to determine where a persistent contrail would plausibly form, with energy-forcing
   magnitudes drawn from the real, documented CoCiP energy-forcing-per-distance percentile
   distribution ([apidocs.contrails.org/ef-interpretation](https://apidocs.contrails.org/ef-interpretation.html)) —
   deterministic, no `Math.random` anywhere.
4. **Critical window detection** (`src/science/criticalWindow.ts`) — isolates the *shortest*
   contiguous segment of the flight responsible for a target share (default 40%) of its total
   positive (warming) energy forcing:

   $$
   \text{find } W \text{ minimizing } |W| \quad \text{s.t.} \quad \sum_{t \in W} EF^{+}(t) \;\geq\; 0.4 \cdot \sum_{t} EF^{+}(t)
   $$

   On our primary demo flight (JFK → LHR, 787-9), an **8-minute window captures 44.5%** of the
   flight's total modeled impact — the smallest meaningful intervention, made concrete.
5. **Counterfactual trajectory generation** (`src/simulation/counterfactualEngine.ts`,
   `altitudeProfile.ts`) — five strategies (full-flight offset, critical-window descent/climb,
   return-to-cruise, multi-step profile), all built on one shared kinematic ramp function that
   never produces an instantaneous altitude jump. A candidate that would exceed the assumed
   service ceiling, or can't physically complete within the available trajectory, is flagged
   infeasible with a human-readable reason rather than silently allowed.
6. **Operational cost modeling** (`src/simulation/operationalCost.ts`) — two independently
   derived, documented effects: a parabolic fuel-flow penalty around the flight's actual recorded
   cruise altitude,

   $$
   \Delta\text{fuel}(\Delta h) \approx a \cdot (\Delta h)^2
   $$

   plus a constant-Mach / ISA time delta, converted to CO₂ via the standard jet-kerosene
   combustion factor:

   $$
   CO_2 = 3.16 \times \text{fuel}_{kg}
   $$
7. **Pareto analysis** (`src/science/pareto.ts`) — standard Pareto dominance (lower cost *and*
   higher impact reduction) filters out strictly dominated candidates, then a transparent
   geometric **knee-point** heuristic — the point farthest from the line connecting the
   frontier's extremes — surfaces the highest-leverage option, explicitly never labeled
   "optimal."
8. **Tradeoff visualization** — a log-scale Pareto chart, a 2D radar-style scope, and an optional
   3D globe present the frontier and the knee point so the reduction in modeled climate impact
   can be weighed directly against the fuel/CO₂/time cost of getting there.

Real numbers from the actual engine, not illustrative placeholders:

```
=== DEMO101 (JFK -> LHR, Boeing 787-9) ===
  Waypoints: 411
  Baseline total energy forcing: 519.196 TJ
  Critical windows found: 1
    - 02:09 -> 02:17 UTC (8 min), 44.5% of flight impact, confidence=low
  Counterfactuals generated: 15
  Knee (high-leverage) option: critical-window-climb 1000ft ->
    44.8% impact reduction, 4.9kg fuel, 15.5kg CO2, 0.0min time delta
  Non-dominated (Pareto frontier) alternatives: 4 / 15

=== DEMO202 (JFK -> LHR, Boeing 787-9, different departure time) ===
  Baseline total energy forcing: 0.000 TJ
  Critical windows found: 0
  (not every flight has the same counterfactual opportunity)

=== DEMO303 (BOS -> DUB, Airbus A320neo) ===
  Baseline total energy forcing: 223.372 TJ
  Critical windows found: 1 (5 min, 48.8% of flight impact)
  Knee option: critical-window-climb 1000ft -> 49.5% impact reduction, 1.4kg fuel, 4.4kg CO2
```

`confidence=low` is intentional: the synthetic atmospheric field marks its own output as
low/medium confidence specifically so the UI can never present demo-mode numbers as if they were
a high-confidence live forecast.

---

## Data sources & API integration

This build environment has **no outbound network access and no API credentials** during
development. That constraint shaped the architecture directly: every data source is either (a)
real and verified against current documentation, or (b) an honestly labeled, physically grounded
offline stand-in with its assumptions written next to the code that computes it — never an
invented "climate score" or a silently fabricated API response.

| Layer | Real source | What's actually running |
|---|---|---|
| Flight trajectories | [OpenSky Network](https://opensky-network.org) — real schema (`icao24`, `callsign`, `/api/tracks/all` waypoints: time, lat/lon, baro altitude, heading) | `OpenSkyClient` (`src/data/providers/openSkyClient.ts`) is **fully implemented**: real OAuth2 client-credentials auth, real `/api/flights/departure` search, real `/api/tracks/all` fetch, mapped into the internal `Flight` model. Live connectivity to OpenSky's real auth server is verified (a placeholder credential correctly received an HTTP 403). **Demo mode** uses reconstructed, representative trajectories instead — real city pairs and aircraft types flown along the great-circle route with a documented phase-of-flight profile — every one tagged `dataProvenance.source: "reconstructed-representative"` so it can never be presented as raw telemetry. |
| Atmospheric / contrail data | [Google Contrails API](https://developers.google.com/contrails) (`/v2/regions` GeoJSON avoidance polygons, `/v2/detections`, 48h forecast-only) and the [Contrails.org / pycontrails CoCiP model](https://apidocs.contrails.org) | `GoogleContrailsProvider` (`src/data/providers/googleContrailsProvider.ts`) is **fully implemented**: real `fetch()` calls against both endpoints, real GeoJSON parsing, a real point-in-polygon test (`src/utils/geo.ts`) — no NetCDF dependency. Live connectivity is verified the same way as OpenSky. **Demo mode** uses a synthetic, physically-motivated atmospheric field calibrated to the real, documented CoCiP energy-forcing percentile distribution instead of a live forecast. |
| Aircraft performance / fuel | [OpenAP](https://github.com/junzis/openap) (Sun et al. 2020) | A simplified, transparent parabolic model around the flight's own recorded cruise altitude, plus a constant-Mach / ISA time-delta model — not a certified performance model. Full derivation in `src/simulation/operationalCost.ts`. |
| CO₂ factor | Standard jet-kerosene combustion factor | `3.16 kg CO₂ / kg fuel`, exactly as documented. |

Both API clients can be run for real right now with your own credentials — see
[Running with real keys](#running-with-real-keys) — and because the science layer only ever
depends on the internal domain model in `src/models/`, never on a provider's raw response shape,
swapping demo data for live data touches **no code** in `src/science` or `src/simulation`.

---

## Architecture

```
src/
  models/         Domain types: Flight, TrajectoryPoint, AtmosphericSample,
                    Counterfactual, TradeoffPoint, CriticalWindow, AircraftModel
  data/            ContrailProvider abstraction + implementations
                    (Google Contrails, OpenSky, Cached, Demo)
  science/         Trajectory cleaning, critical-window detection, impact
                    aggregation, Pareto frontier + knee point, the synthetic
                    atmospheric field, and the pipeline orchestrator (analyzeFlight)
  simulation/      Kinematic altitude-ramp construction, the counterfactual
                    engine, and the fuel/CO2/time operational-cost model
  utils/           Geodesy (haversine, great-circle interpolation) and the
                    ICAO Standard Atmosphere temperature model
scripts/
  precompute-demo-flights.ts   Runs the full pipeline per demo flight, prints
                                 validation output, writes bundled JSON
demo-data/
  flights/         Precomputed baseline trajectories + one full analysis
ui/
  src/             logic.js (pure/tested), app.js (2D radar scope), whatif.js
                    (WHAT IF? builder), pareto.js (tradeoff view), globe.js
                    (3D globe), satellite.js (labeled synthetic overlay)
server.ts          Local Node server exposing real OpenSky / Google Contrails
                    routes when API keys are present
```

Nothing in `src/science` or `src/simulation` imports from `src/data/providers/*` directly —
everything talks to the `ContrailProvider` interface and the domain types in `src/models`. That's
what makes "demo mode now, live API later" an actual property of the code, not just a stated
intention.

---

## The frontend

A single self-contained HTML page (`ui/dist/index.html`), assembled from framework-free source
modules and bundled with esbuild — no framework, no required bundler runtime, no CDN dependency
beyond one pinned Three.js build.

- **2D radar scope** — canvas-based, range rings, risk-colored route segments, critical-window
  glow, replay transport controls, altitude profile chart.
- **3D globe** — Three.js r128 (pinned UMD), custom drag/zoom camera controls, no `OrbitControls`
  dependency. A genuine enhancement layered on the 2D scope, never required — it self-reports
  WebGL availability and the UI falls back to 2D automatically.
- **WHAT IF? builder** — every altitude offset and strategy, a zoomed actual-vs-counterfactual
  chart (so a 1–4k ft change isn't invisible against a 0–38,000 ft scale), and a "how was this
  calculated?" panel per result.
- **Pareto explorer** — log-scale cost axis (generated alternatives span roughly three orders of
  magnitude in fuel cost), non-dominated frontier and knee-point highlighting, and
  non-monotonic ("made it worse") results plotted honestly rather than hidden.
- The engine runs **live, in-browser**: `src/browser-entry.ts` is bundled into
  `engine.bundle.js` and calls the exact same `analyzeFlight()` pipeline as the precompute
  script — verified to reproduce the same validated numbers client-side.
- Accessibility: keyboard-operable throughout, visible focus rings, ARIA labels/roles on every
  chart and canvas, `aria-live` readouts during replay, `prefers-reduced-motion` support.

---

## Quick start

```bash
cd isobar
npm install
cp .env.example .env   # optional — only needed for real API keys, see below

npm run test:all      # 60 engine/provider tests + 29 UI-logic tests, all offline
npm run build:ui      # bundles src/ into engine.bundle.js, assembles ui/dist/index.html

npx serve ui/dist
# → open the printed http://localhost:3000
```

No API keys, accounts, or network access are required — demo mode runs entirely against the
bundled, precomputed dataset in `demo-data/`. `ui/dist/index.html` is a complete, self-contained
app; you can also just double-click it to open it directly in a browser.

### Running with real keys

The static `ui/dist/index.html` never reads `.env` and never calls a live API — it's a public
file with no backend, by design, since a real key baked into that bundle would be visible to
every visitor. To actually exercise your keys:

```bash
cp .env.example .env
# fill in GOOGLE_CONTRAILS_API_KEY and/or OPENSKY_CLIENT_ID + OPENSKY_CLIENT_SECRET

npm run build:ui
npm run serve:live     # real Node server on :8787, reads .env itself
```

```bash
# real OpenSky search — actual recent departures from JFK
curl "http://localhost:8787/api/opensky/search?airport=KJFK"

# real OpenSky track, run through the actual analysis pipeline
curl "http://localhost:8787/api/opensky/analyze?icao24=<hex>&time=<unix>"

# real Google Contrails /v2/regions sample (point must be within the next 48h)
curl "http://localhost:8787/api/google/check?lat=51&lon=-20&alt=36000"
```

Every route logs `[opensky] real request: ...` / `[google] real request: ...` right before it
fires, and a bad/missing key returns a clean JSON `{"error": ...}` — confirmed against both
providers' real servers with placeholder credentials (a correct HTTP 403 in both cases). Full
setup instructions (creating a Google Cloud project + enabling the Contrails API, creating an
OpenSky OAuth2 client) are in the header comments of `googleContrailsProvider.ts` and
`openSkyClient.ts`.

---

## Assumptions & limitations, honestly stated

- **Atmospheric data is synthetic**, calibrated to real documented CoCiP statistics, not a live
  weather model run. See [Data sources & API integration](#data-sources--api-integration).
- **Fuel/time model is a simplified, transparent approximation**, not a certified aircraft
  performance model.
- **Demo trajectories are reconstructed/representative**, not raw ADS-B telemetry, because this
  development environment cannot reach OpenSky's network — though the client that would fetch it
  for real is implemented and tested.
- **Kinematic transitions use simplified constant-rate assumptions**, not a full flight-dynamics
  model.
- **Energy forcing and CO₂ are reported separately and never converted into one another** — they
  are physically different quantities (radiative forcing vs. a well-mixed greenhouse gas), and
  collapsing them into one number would hide more than it reveals.

---

## What's next

**Wire live keys into the deployed UI.** The OpenSky and Google Contrails clients are already
real, tested, and live-verified (`npm run serve:live`) — the next step is surfacing that
capability in the hosted app itself, not just a local server.

**Lateral rerouting.** The counterfactual engine currently focuses on vertical step-climbs and
descents, since that's the most efficient way to exit a thin ISSR layer. The next iteration
extends the counterfactual envelope to lateral and speed-based alternatives, for cases where a
vertical change alone is too costly or infeasible.

**Live weather ensemble forecasting.** Moving from a retrospective replay tool to an active
operational aid means integrating live high-resolution ensemble forecasts (e.g. ECMWF or GFS)
so dispatchers can evaluate a tradeoff before takeoff, not just replay a historical flight.

**Economic and carbon-pricing models.** Translating modeled $\Delta$Fuel and $\Delta CO_2$ into
direct dollar values, with projected carbon-credit pricing applied to avoided contrail impact —
so the ROI of a climate-optimized route is as visible as the operational cost is today.

**Probabilistic contrail modeling.** Atmospheric humidity forecasting is genuinely hard.
Future builds should shift from a single deterministic energy-forcing number toward confidence
intervals ("an 85% probability this intervention avoids a high-impact contrail"), so an
airline never burns extra fuel chasing a climate benefit that doesn't materialize.

**A real aircraft performance model.** Swap the parabolic fuel approximation for OpenAP for a
small set of common aircraft types.

---

## License

MIT — see `LICENSE`.
