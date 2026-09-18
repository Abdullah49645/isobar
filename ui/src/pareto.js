/* ==========================================================================
   CONTRAIL TRADEOFF — Phase 3: PARETO / TRADEOFF view
   Plots the precomputed TradeoffPoint[] (src/science/pareto.ts) on a
   log-scale cost axis, since full-flight-offset strategies span roughly
   three orders of magnitude in fuel cost versus localized interventions
   (~4.8kg to ~3,192kg in the primary demo flight) — a linear axis
   compresses everything near x=0. Non-monotonic points (negative benefit)
   are plotted as-is, never hidden.
   ========================================================================== */
(function () {
  "use strict";

  let wired = false;

  function reset(state) {
    const host = document.getElementById("paretoTeaserHost");
    const pts = state.current.tradeoffPoints || [];
    if (!pts.length) {
      host.classList.add("hidden");
      return;
    }
    host.classList.remove("hidden");
    const nonDom = pts.filter((p) => p.isNonDominated).length;
    host.innerHTML = `
      <div class="panel-title">The tradeoff</div>
      <div class="empty-note" style="margin-bottom:10px;">${pts.length} generated alternatives &middot; ${nonDom} on the Pareto frontier.</div>
      <button class="btn btn-ghost pareto-teaser-cta" id="openParetoBtn">View full tradeoff →</button>
    `;
    document.getElementById("openParetoBtn").addEventListener("click", () => openPareto(state));

    if (!wired) {
      document.getElementById("paretoClose").addEventListener("click", closePareto);
      document.getElementById("paretoBackdrop").addEventListener("click", (e) => {
        if (e.target.id === "paretoBackdrop") closePareto();
      });
      wired = true;
    }
  }

  function closePareto() {
    document.getElementById("paretoBackdrop").classList.remove("open");
  }

  function openPareto(state) {
    renderChart(state);
    document.getElementById("paretoBackdrop").classList.add("open");
  }

  function renderChart(state) {
    const svg = document.getElementById("paretoSvg");
    const tooltip = document.getElementById("paretoTooltip");
    const pts = state.current.tradeoffPoints;
    const cfsById = {};
    state.current.counterfactuals.forEach((c) => (cfsById[c.id] = c));

    const W = 900, H = 440, padL = 56, padR = 24, padT = 20, padB = 46;
    const { x, y, minCost, maxCost, minB, maxB } = window.IsobarLogic.paretoScales(pts, { W, H, padL, padR, padT, padB });

    let xTicks = "";
    [1, 10, 100, 1000, 10000].forEach((v) => {
      if (v < minCost || v > maxCost) return;
      const px = x(v);
      xTicks += `<line x1="${px}" y1="${padT}" x2="${px}" y2="${H - padB}" stroke="var(--panel-border)" stroke-width="1"/>
        <text x="${px}" y="${H - padB + 16}" font-family="var(--mono)" font-size="10" fill="var(--text-2)" text-anchor="middle">${v >= 1000 ? v / 1000 + "t" : v + "kg"}</text>`;
    });

    const zeroY = y(0);
    let yTicks = `<line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="var(--line-mid)" stroke-width="1"/>
      <text x="${padL - 8}" y="${zeroY + 3}" font-family="var(--mono)" font-size="10" fill="var(--text-2)" text-anchor="end">0%</text>`;
    [0.25, 0.5, 0.75, 1].forEach((v) => {
      if (v > maxB) return;
      const py = y(v);
      yTicks += `<line x1="${padL}" y1="${py}" x2="${W - padR}" y2="${py}" stroke="var(--panel-border)" stroke-width="1"/>
        <text x="${padL - 8}" y="${py + 3}" font-family="var(--mono)" font-size="10" fill="var(--text-2)" text-anchor="end">${Math.round(v * 100)}%</text>`;
    });

    const frontier = pts.filter((p) => p.isNonDominated).sort((a, b) => a.operationalCost - b.operationalCost);
    let frontierPath = "";
    frontier.forEach((p, i) => {
      frontierPath += `${i === 0 ? "M" : "L"}${x(p.operationalCost).toFixed(1)},${y(p.contrailBenefit).toFixed(1)} `;
    });

    let circles = "";
    pts.forEach((p) => {
      const color = p.isKneePoint ? "var(--good)" : p.isNonDominated ? "var(--accent)" : "var(--text-2)";
      const r = p.isKneePoint ? 7 : p.isNonDominated ? 5.5 : 4;
      circles += `<circle class="pareto-point" data-id="${p.counterfactualId}" cx="${x(p.operationalCost).toFixed(1)}" cy="${y(p.contrailBenefit).toFixed(1)}" r="${r}" fill="${color}" stroke="${p.isKneePoint ? "rgba(127,224,167,0.4)" : "none"}" stroke-width="5"/>`;
    });

    const baseX = padL - 30;
    const baseline = `<g>
      <line x1="${baseX}" y1="${padT}" x2="${baseX}" y2="${H - padB}" stroke="var(--panel-border)" stroke-width="1" stroke-dasharray="2,3"/>
      <circle cx="${baseX}" cy="${zeroY}" r="6" fill="var(--bad)"/>
      <text x="${baseX}" y="${H - padB + 16}" font-family="var(--mono)" font-size="9.5" fill="var(--bad)" text-anchor="middle">ACTUAL</text>
    </g>`;

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = `
      ${xTicks}${yTicks}
      <text x="${(padL + W - padR) / 2}" y="${H - 4}" font-family="var(--mono)" font-size="10.5" fill="var(--text-2)" text-anchor="middle">operational cost (estimated fuel, log scale) →</text>
      <text x="16" y="${(padT + H - padB) / 2}" font-family="var(--mono)" font-size="10.5" fill="var(--text-2)" text-anchor="middle" transform="rotate(-90 16 ${(padT + H - padB) / 2})">contrail impact reduction</text>
      ${baseline}
      <path d="${frontierPath}" fill="none" stroke="var(--accent)" stroke-width="1.2" stroke-dasharray="3,3" opacity="0.5"/>
      ${circles}
    `;

    svg.querySelectorAll(".pareto-point").forEach((el) => {
      el.addEventListener("mousemove", (e) => showTooltip(e, el, pts, cfsById, svg, tooltip));
      el.addEventListener("mouseleave", () => tooltip.classList.remove("show"));
      el.addEventListener("click", () => {
        const cf = cfsById[el.dataset.id];
        if (cf && window.WhatIf) {
          closePareto();
          window.WhatIf.selectDirect(state, cf);
        }
      });
    });

    const knee = pts.find((p) => p.isKneePoint);
    const callout = document.getElementById("paretoKneeCallout");
    if (knee) {
      const cf = cfsById[knee.counterfactualId];
      callout.innerHTML = `<strong>High-leverage option:</strong> ${cf.strategy.kind.replace(/-/g, " ")} ${cf.strategy.altitudeOffsetFt > 0 ? "+" : ""}${cf.strategy.altitudeOffsetFt}ft reduces modeled contrail impact by ${(cf.impactReduction * 100).toFixed(1)}% for an estimated ${cf.estimatedFuelDeltaKg.toFixed(1)}kg fuel — a small fraction of the ${Math.max(...pts.map((p) => p.operationalCost)).toFixed(0)}kg the most aggressive alternative costs for full elimination. Not called "optimal" — the right tradeoff depends on priorities this system doesn't set.`;
    } else {
      callout.textContent = "";
    }
  }

  function showTooltip(e, el, pts, cfsById, svg, tooltip) {
    const p = pts.find((pp) => pp.counterfactualId === el.dataset.id);
    const cf = cfsById[el.dataset.id];
    if (!p || !cf) return;
    const wrap = svg.parentElement.getBoundingClientRect();
    tooltip.style.left = e.clientX - wrap.left + "px";
    tooltip.style.top = e.clientY - wrap.top + "px";
    tooltip.innerHTML = `${cf.strategy.kind.replace(/-/g, " ")} ${cf.strategy.altitudeOffsetFt > 0 ? "+" : ""}${cf.strategy.altitudeOffsetFt}ft<br>${(p.contrailBenefit * 100).toFixed(1)}% impact &middot; ${p.operationalCost.toFixed(1)}kg fuel<br>uncertainty: ${p.uncertainty}${p.isKneePoint ? "<br><strong style=\"color:var(--good)\">knee point</strong>" : p.isNonDominated ? "<br>non-dominated" : ""}`;
    tooltip.classList.add("show");
  }

  window.ParetoView = { reset };
})();
