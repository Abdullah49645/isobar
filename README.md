# Contrail Tradeoff

### Counterfactual flight planning for reducing aviation's contrail climate impact

> **What if a small change in a flight's trajectory could substantially reduce its modeled contrail climate impact — and what would that change cost?**

**Contrail Tradeoff** is a counterfactual flight-analysis engine that replays real flight trajectories, identifies atmospheric regions where persistent contrails are more likely to form, and generates physically constrained alternative flight profiles. 

Aviation contributes to global warming not just through carbon dioxide emissions, but significantly through non-CO<sub>2</sub> effects—most notably, the formation of persistent contrail cirrus clouds. When aircraft fly through cold, humid air masses known as Ice Supersaturated Regions (ISSRs), water vapor condenses and freezes around exhaust soot, creating artificial clouds that trap outgoing terrestrial heat.

Rather than simply detecting these contrails after a flight has occurred, Contrail Tradeoff asks a more actionable, predictive question:

> **What could have happened if the aircraft had flown differently?**

The system evaluates alternative trajectories and quantifies the tradeoff between **modeled contrail climate impact** (measured in energy forcing) and **operational cost**, including fuel consumption, CO<sub>2</sub> emissions, and flight time. 

The goal is not to blindly dictate a single "perfect" trajectory. Instead, Contrail Tradeoff exposes the **Pareto frontier of feasible alternatives**, allowing the climate benefit of an intervention to be compared directly against its operational penalty.

---

## Built For

Contrail Tradeoff was built for **[TechCommons Hacks V2 — Hacks to Inspire](https://techcommons-hacks-v2.devpost.com/?ref_feature=challenge&ref_medium=your-open-hackathons&ref_content=Submissions+open)**. 

The project was developed specifically for the hackathon around the intersection of:
*   Machine learning and scientific computing
*   Climate and environmental impact
*   Aviation physics
*   Data-driven decision making
*   Real-world optimization

---

## The Problem

Persistent aviation contrails can have a severe warming effect, but their formation is highly dependent on localized atmospheric conditions along an aircraft's specific 4D trajectory (latitude, longitude, altitude, and time).

This creates an unusual optimization problem. A flight does not necessarily need to be completely rerouted to reduce its impact. A relatively small change in altitude—often just 1,000 to 2,000 feet—could potentially move the aircraft out of an ISSR, eliminating the contrail entirely.

However, that intervention comes with a cost. Commercial aircraft are meticulously flight-planned to cruise at optimal altitudes that minimize drag and fuel burn. Deviating from this optimum increases:
*   Fuel consumption
*   Direct CO<sub>2</sub> emissions
*   Flight time
*   Operational complexity for Air Traffic Control (ATC)

This means that **minimizing contrail impact alone is not sufficient**. We must balance the reduction in contrail radiative forcing against the increase in CO<sub>2</sub> forcing, which lasts for centuries. 

The core optimization problem seeks to explore the feasible trajectory space $\mathcal{T}$ to evaluate the cost-benefit ratio of an alternative trajectory $T_{alt}$ compared to the baseline trajectory $T_{base}$:

$$
\Delta \text{NetImpact} = f(\Delta \text{ContrailForcing}) - g(\Delta \text{CO}_2, \Delta \text{Fuel}, \Delta \text{Time})
$$

Contrail Tradeoff was designed to make that tradeoff measurable, answering the fundamental question: *How much climate impact can we avoid for a given operational cost?*

---

## How It Works: The Simulation Pipeline

The system processes flights through a rigorous, counterfactual simulation pipeline, moving from raw data ingestion to Pareto optimization.

1. **Flight Trajectory Normalization:** Ingests raw ADS-B telemetry and normalizes the 4D path to ensure consistent spatial and temporal resolution.
2. **Atmospheric Reconstruction:** Queries historical or forecasted meteorological data (temperature, humidity, wind shear) along the normalized flight path to identify the boundaries of Ice Supersaturated Regions (ISSRs).
3. **Contrail Formation Modeling:** Applies physical and empirical models to determine if a persistent contrail would form given the aircraft's specific engine parameters and the reconstructed atmosphere.
4. **Critical Window Detection:** Isolates the specific segments of the flight (the "critical windows") where contrail generation is active and structurally significant.
5. **Counterfactual Trajectory Generation:** Generates a localized envelope of feasible alternative flight profiles (e.g., step-climbs or step-descents) that avoid the critical window while adhering to aircraft performance limits and standard ATC flight levels.
6. **Operational Cost Modeling:** Calculates the fuel burn, total CO<sub>2</sub> emitted, and time delta for each counterfactual trajectory using established aircraft performance models.
7. **Pareto Analysis:** Filters the generated profiles to eliminate strictly dominated options, isolating the mathematical Pareto frontier.
8. **Tradeoff Visualization:** Presents the data to dispatchers or analysts, plotting climate impact reduction directly against additional fuel/CO<sub>2</sub> costs.

---

## What's Next

While Contrail Tradeoff establishes a robust framework for vertical trajectory optimization, the roadmap for the project involves scaling its predictive capabilities and integrating deeper into airline operations:

### 1. Lateral Rerouting Capabilities
Currently, the counterfactual engine focuses heavily on vertical step-climbs and descents, as these are the most efficient ways to exit thin atmospheric ISSR layers. The next iteration will generate **lateral and speed-based counterfactuals**, expanding the 3D optimization envelope to circumnavigate weather systems entirely when vertical changes are too costly.

### 2. Live Forecasting & API Integration
To move from a retrospective analysis tool to an active operational aid, Contrail Tradeoff will integrate with live high-resolution weather ensemble forecasts (like the ECMWF or GFS). This will allow the engine to expose an API for flight dispatchers to evaluate contrail tradeoffs *before* takeoff, rather than just replaying historical flights.

### 3. Economic and Carbon Pricing Models
Airlines operate on strict financial margins. The next update will introduce dynamic economic modeling, translating the $\Delta$ Fuel and $\Delta$ CO<sub>2</sub> into direct dollar values, while applying projected carbon-credit pricing to the avoided contrail impact. This will allow airlines to see the direct financial ROI of flying a climate-optimized route.

### 4. Handling Weather Uncertainty
Atmospheric humidity forecasting is notoriously difficult. Future builds will incorporate probabilistic contrail modeling, shifting the output from deterministic calculations to confidence intervals (e.g., *"This intervention has an 85% probability of avoiding a high-impact contrail"*), ensuring that airlines do not burn extra fuel for a climate benefit that fails to materialize.
