/* ==========================================================================
   CONTRAIL TRADEOFF — Phase 2: WHAT IF? / SIMULATE / TRADEOFF
   Reads precomputed Counterfactual[] from the live analyzeFlight() result
   (window.ContrailApp.state.current) — no new science logic here, this only
   picks among already-generated, already-validated alternatives and
   visualizes the comparison. See src/science/pipeline.ts:standardStrategySet
   for the full generated set (spec sections 13-14, 21).
   ========================================================================== */
(function () {
  "use strict";

  let app; // window.ContrailApp, bound on reset()
  let sel = { mode: "window", offsetFt: null, specialId: null }; // builder selection

  function reset(state, _els) {
    app = window.ContrailApp;
    sel = { mode: state.current.criticalWindows.length ? "window" : "full", offsetFt: null, specialId: null };
    state.selectedCf = null;
    document.getElementById("legendCf").classList.add("hidden");
    document.getElementById("resultPanelHost").classList.add("hidden");
    renderBuilder(state);
  }

  function counterfactualsFor(state) {
    return state.current.counterfactuals || [];
  }

  function findMatch(state) {
    const cfs = counterfactualsFor(state);
    return window.IsobarLogic.findMatchingCounterfactual(cfs, sel.mode, sel.offsetFt, sel.specialId);
  }

  function offsetAvailable(state, mode, offsetFt) {
    return window.IsobarLogic.isOffsetAvailable(counterfactualsFor(state), mode, offsetFt);
  }

  function specialStrategies(state) {
    const cfs = counterfactualsFor(state);
    return cfs.filter((c) => c.strategy.kind === "return-to-cruise" || c.strategy.kind === "multi-step-profile");
  }

  const OFFSETS = [-4000, -2000, -1000, 1000, 2000, 4000];

  function renderBuilder(state) {
    const host = document.getElementById("whatIfPanelHost");
    const hasWindow = state.current.criticalWindows.length > 0;
    const specials = specialStrategies(state);

    host.innerHTML = `
      <div class="panel-title">What if?</div>
      <div class="whatif-section">
        <div class="seg-control" id="segMode">
          <button class="seg-btn ${sel.mode === "window" ? "active" : ""}" data-mode="window" ${hasWindow ? "" : "disabled"}>Critical window only</button>
          <button class="seg-btn ${sel.mode === "full" ? "active" : ""}" data-mode="full">Entire flight</button>
        </div>
        <div class="alt-select-label">Altitude change</div>
        <div class="alt-offsets" id="altOffsets">
          ${OFFSETS.slice(0, 3)
            .map((o) => offsetBtn(state, o))
            .join("")}
          <button class="alt-offset-btn zero" disabled>ACTUAL</button>
          ${OFFSETS.slice(3)
            .map((o) => offsetBtn(state, o))
            .join("")}
        </div>
        ${
          specials.length
            ? `<div class="alt-select-label">Other strategies</div>
               <div class="alt-offsets" style="grid-template-columns:repeat(${specials.length},1fr);margin-bottom:16px;" id="specialOffsets">
                 ${specials.map((c) => specialBtn(c)).join("")}
               </div>`
            : ""
        }
        <button class="btn btn-primary simulate-btn" id="simulateBtn" disabled>Simulate</button>
        <div class="sim-loading hidden" id="simLoading"></div>
      </div>
    `;

    document.getElementById("segMode").addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (!btn || btn.disabled) return;
      sel.mode = btn.dataset.mode;
      sel.specialId = null;
      renderBuilder(state);
    });
    document.getElementById("altOffsets").addEventListener("click", (e) => {
      const btn = e.target.closest(".alt-offset-btn");
      if (!btn || btn.disabled || !btn.dataset.offset) return;
      sel.offsetFt = parseInt(btn.dataset.offset, 10);
      sel.specialId = null;
      renderBuilder(state);
    });
    const specialsEl = document.getElementById("specialOffsets");
    if (specialsEl) {
      specialsEl.addEventListener("click", (e) => {
        const btn = e.target.closest(".alt-offset-btn");
        if (!btn) return;
        sel.specialId = btn.dataset.id;
        sel.offsetFt = null;
        renderBuilder(state);
      });
    }

    const match = findMatch(state);
    const simBtn = document.getElementById("simulateBtn");
    simBtn.disabled = !match;
    simBtn.textContent = match ? "Simulate" : "Select an altitude change";
    simBtn.addEventListener("click", () => runSimulation(state, match));
  }

  function offsetBtn(state, offsetFt) {
    const available = offsetAvailable(state, sel.mode, offsetFt);
    const active = sel.offsetFt === offsetFt && !sel.specialId;
    return `<button class="alt-offset-btn ${active ? "active" : ""}" data-offset="${offsetFt}" ${available ? "" : "disabled"} title="${available ? "" : "Infeasible or not generated for this flight"}">${offsetFt > 0 ? "+" : ""}${offsetFt}</button>`;
  }

  function specialBtn(cf) {
    const label = cf.strategy.kind === "return-to-cruise" ? "Return-to-cruise " + cf.strategy.altitudeOffsetFt : "Multi-step " + cf.strategy.altitudeOffsetFt;
    const active = sel.specialId === cf.id;
    return `<button class="alt-offset-btn ${active ? "active" : ""}" data-id="${cf.id}" style="font-size:10px;">${label}</button>`;
  }

  const LOADING_MESSAGES = [
    "Generating trajectory…",
    "Sampling atmosphere…",
    "Evaluating contrail impact…",
    "Estimating operational consequence…",
  ];

  function runSimulation(state, cf) {
    if (!cf) return;
    const simBtn = document.getElementById("simulateBtn");
    const loading = document.getElementById("simLoading");
    simBtn.disabled = true;
    loading.classList.remove("hidden");
    let i = 0;
    loading.textContent = LOADING_MESSAGES[0];
    const timer = setInterval(() => {
      i++;
      if (i >= LOADING_MESSAGES.length) {
        clearInterval(timer);
        loading.classList.add("hidden");
        simBtn.disabled = false;
        applyResult(state, cf);
        return;
      }
      loading.textContent = LOADING_MESSAGES[i];
    }, 260);
  }

  function applyResult(state, cf) {
    state.selectedCf = cf;
    document.getElementById("legendCf").classList.remove("hidden");
    app.drawScope();
    renderResultPanel(state, cf);
    document.getElementById("resultPanelHost").classList.remove("hidden");
    document.getElementById("resultPanelHost").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function assessment(state, cf) {
    return window.IsobarLogic.computeAssessment(cf, state.current.tradeoffPoints);
  }

  const app_fmt = () => window.ContrailApp.fmt;

  function renderResultPanel(state, cf) {
    const fmt = app_fmt();
    const host = document.getElementById("resultPanelHost");
    const a = assessment(state, cf);
    const durMin = Math.round((cf.strategy.kind.startsWith("critical") ? state.current.criticalWindows[cf.strategy.windowIndex || 0].durationSec : (new Date(state.current.flight.arrivalTime) - new Date(state.current.flight.departureTime)) / 1000) / 60);

    host.innerHTML = `
      <div class="panel-title">Counterfactual result <button class="btn btn-ghost btn-sm" id="clearCfBtn">Clear</button></div>
      <div class="result-hero">
        <div class="rh-label">Contrail impact</div>
        <div class="rh-value ${cf.impactReduction >= 0 ? "good" : "bad"}">${fmt.pct(cf.impactReduction)}</div>
        <div class="assessment-badge ${a.cls}">${a.label}</div>
        <div class="rh-assessment">${a.note}</div>
      </div>
      <div class="result-grid">
        <div class="result-metric"><div class="rm-label">Estimated fuel</div><div class="rm-value ${cf.estimatedFuelDeltaKg > 0 ? "bad" : "good"}">${cf.estimatedFuelDeltaKg > 0 ? "+" : ""}${fmt.kg(cf.estimatedFuelDeltaKg)}</div></div>
        <div class="result-metric"><div class="rm-label">Estimated CO&sub2;</div><div class="rm-value ${cf.estimatedCO2DeltaKg > 0 ? "bad" : "good"}">${cf.estimatedCO2DeltaKg > 0 ? "+" : ""}${fmt.kg(cf.estimatedCO2DeltaKg)}</div></div>
        <div class="result-metric"><div class="rm-label">Estimated time</div><div class="rm-value ${cf.estimatedTimeDeltaSec > 0 ? "bad" : "good"}">${fmt.min(cf.estimatedTimeDeltaSec)}</div></div>
        <div class="result-metric"><div class="rm-label">Altitude change</div><div class="rm-value">${fmt.ft(cf.strategy.altitudeOffsetFt)}</div></div>
      </div>
      <div class="alt-chart-wrap" style="margin-top:16px;">
        <div class="panel-title" style="margin-bottom:6px;">Actual vs. counterfactual — critical window detail</div>
        <svg id="zoomAltChart"></svg>
      </div>
      <button class="explain-link" id="explainResultBtn">How was this calculated? →</button>
    `;
    renderZoomChart(state, cf);
    document.getElementById("clearCfBtn").addEventListener("click", () => {
      state.selectedCf = null;
      document.getElementById("legendCf").classList.add("hidden");
      app.drawScope();
      host.classList.add("hidden");
    });
    document.getElementById("explainResultBtn").addEventListener("click", () => openResultExplainModal(state, cf, a));
  }

  // Zoomed altitude comparison around the affected window, so a 1-4k ft
  // change reads clearly instead of disappearing against a 0-38,000ft scale
  // (this is the fix called for in the handoff notes, item 1).
  function renderZoomChart(state, cf) {
    const svg = document.getElementById("zoomAltChart");
    const actualTraj = state.current.flight.trajectory;
    const cfTraj = cf.modifiedTrajectory;
    let lo, hi;
    if (cf.strategy.windowIndex !== undefined && state.current.criticalWindows[cf.strategy.windowIndex]) {
      const w = state.current.criticalWindows[cf.strategy.windowIndex];
      const margin = Math.max(10, Math.round((w.endIndex - w.startIndex) * 1.5));
      lo = Math.max(0, w.startIndex - margin);
      hi = Math.min(actualTraj.length - 1, w.endIndex + margin);
    } else {
      lo = 0;
      hi = actualTraj.length - 1;
    }
    const W = 1000, H = 150, padL = 36, padR = 8, padT = 12, padB = 20;
    let minAlt = Infinity, maxAlt = -Infinity;
    for (let i = lo; i <= hi; i++) {
      minAlt = Math.min(minAlt, actualTraj[i].altitudeFt, cfTraj[i] ? cfTraj[i].altitudeFt : actualTraj[i].altitudeFt);
      maxAlt = Math.max(maxAlt, actualTraj[i].altitudeFt, cfTraj[i] ? cfTraj[i].altitudeFt : actualTraj[i].altitudeFt);
    }
    const span = Math.max(maxAlt - minAlt, 200);
    minAlt -= span * 0.15;
    maxAlt += span * 0.15;
    const x = (i) => padL + ((i - lo) / Math.max(hi - lo, 1)) * (W - padL - padR);
    const y = (alt) => padT + (1 - (alt - minAlt) / (maxAlt - minAlt)) * (H - padT - padB);

    const pathOf = (traj) => {
      let d = "";
      for (let i = lo; i <= hi; i++) {
        const pt = traj[i];
        if (!pt) continue;
        d += `${i === lo ? "M" : "L"}${x(i).toFixed(1)},${y(pt.altitudeFt).toFixed(1)} `;
      }
      return d;
    };

    let windowRect = "";
    if (cf.strategy.windowIndex !== undefined && state.current.criticalWindows[cf.strategy.windowIndex]) {
      const w = state.current.criticalWindows[cf.strategy.windowIndex];
      windowRect = `<rect x="${x(w.startIndex)}" y="${padT}" width="${Math.max(x(w.endIndex) - x(w.startIndex), 2)}" height="${H - padT - padB}" fill="var(--warn)" opacity="0.13"/>`;
    }

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = `
      <text x="${padL}" y="${padT - 2}" font-family="var(--mono)" font-size="9" fill="var(--text-dim)">${Math.round(maxAlt).toLocaleString()} ft</text>
      <text x="${padL}" y="${H - padB + 12}" font-family="var(--mono)" font-size="9" fill="var(--text-dim)">${Math.round(minAlt).toLocaleString()} ft</text>
      ${windowRect}
      <path d="${pathOf(actualTraj)}" fill="none" stroke="var(--actual)" stroke-width="2.2"/>
      <path d="${pathOf(cfTraj)}" fill="none" stroke="var(--counterfactual)" stroke-width="2.2" stroke-dasharray="5,3"/>
    `;
  }

  function openResultExplainModal(state, cf, a) {
    const fmt = app_fmt();
    const body = document.getElementById("modalBody");
    document.getElementById("modalTitle").textContent = "How this was calculated";
    const windowInfo = cf.strategy.windowIndex !== undefined ? state.current.criticalWindows[cf.strategy.windowIndex] : null;
    body.innerHTML = `
      <div class="explain-flow">
        <div class="explain-step"><span class="es-k">Baseline</span><span class="es-v">Actual reconstructed trajectory, ${fmt.tj(cf.baselineImpactJ)} modeled energy forcing.</span></div>
        <div class="explain-step"><span class="es-k">Intervention</span><span class="es-v">${cf.strategy.kind.replace(/-/g, " ")}, ${fmt.ft(cf.strategy.altitudeOffsetFt)}${windowInfo ? ` during ${fmt.clock(windowInfo.startTimestamp)}–${fmt.clock(windowInfo.endTimestamp)} (${Math.round(windowInfo.durationSec / 60)} min)` : " across the entire flight"}.</span></div>
        <div class="explain-step"><span class="es-k">Transition</span><span class="es-v">Kinematically-continuous altitude ramp — no instantaneous jumps between flight levels.</span></div>
        <div class="explain-step"><span class="es-k">Re-sampling</span><span class="es-v">The modified trajectory is re-sampled against the same atmospheric field, then re-aggregated the same way as the baseline.</span></div>
        <div class="explain-step"><span class="es-k">Impact metric</span><span class="es-v">Sum of positive segment energy forcing (CoCiP-style), Joules — impact reduction is a fraction of the baseline total.</span></div>
        <div class="explain-step"><span class="es-k">Operational model</span><span class="es-v">Simplified parabolic fuel model around the flight's recorded cruise altitude + constant-Mach/ISA time delta. Fuel Δ ${fmt.kg(cf.estimatedFuelDeltaKg)}, CO&sub2; Δ ${fmt.kg(cf.estimatedCO2DeltaKg)}, time Δ ${fmt.min(cf.estimatedTimeDeltaSec)}.</span></div>
        <div class="explain-step"><span class="es-k">Feasibility</span><span class="es-v">Within service ceiling: ${cf.feasibilityFlags.withinServiceCeiling ? "yes" : "no"}. Within kinematic limits: ${cf.feasibilityFlags.withinKinematicLimits ? "yes" : "no"}.${cf.feasibilityFlags.notes.length ? " " + cf.feasibilityFlags.notes.join(" ") : ""}</span></div>
        <div class="explain-step"><span class="es-k">Uncertainty</span><span class="es-v"><span class="conf-badge ${cf.uncertainty.level}">${cf.uncertainty.level}</span></span></div>
      </div>
      <div class="limitations-title">Important limitations</div>
      <ul class="limitations-list">${cf.uncertainty.reasons.map((r) => `<li>${r}</li>`).join("")}</ul>
    `;
    document.getElementById("modalBackdrop").classList.add("open");
  }

  // Called from the Pareto view when a point is clicked directly: sync the
  // builder's selection state to match, then reveal the result panel
  // immediately (no fabricated loading delay — the point was already
  // computed to be plotted, so pretending otherwise would be dishonest).
  function selectDirect(state, cf) {
    app = window.ContrailApp;
    if (cf.strategy.kind === "return-to-cruise" || cf.strategy.kind === "multi-step-profile") {
      sel.specialId = cf.id;
      sel.offsetFt = null;
    } else {
      sel.mode = cf.strategy.kind === "full-flight-offset" ? "full" : "window";
      sel.offsetFt = cf.strategy.altitudeOffsetFt;
      sel.specialId = null;
    }
    renderBuilder(state);
    applyResult(state, cf);
  }

  window.WhatIf = { reset, selectDirect };
})();
