/* ==========================================================================
   CONTRAIL TRADEOFF — application logic (Phase 1: landing, replay, drawer)
   Consumes window.ContrailEngine (bundled from the verified src/ engine —
   see src/browser-entry.ts). No science/simulation logic lives here; this
   file only visualizes analyzeFlight() output and drives interaction.
   ========================================================================== */
(function () {
  "use strict";

  const FLIGHT_META = {
    "demo-jfk-lhr-b789": { blurb: "Eastbound transatlantic crossing. A sustained ice-supersaturated region concentrates most of the flight's modeled impact into one window." },
    "demo-jfk-lhr-b789-clear": { blurb: "Same route and aircraft, different atmosphere. Conditions along this track never cross the threshold for a persistent contrail." },
    "demo-bos-dub-a20n": { blurb: "Shorter narrowbody crossing. A moderate, more diffuse contrail-sensitive stretch — a genuine tradeoff case." },
  };

  const state = {
    view: "landing",
    cache: {},          // flightKey -> FlightAnalysis
    cardsReady: false,
    current: null,       // active FlightAnalysis
    currentKey: null,
    playIndex: 0,
    playing: false,
    playTimer: null,
    selectedCfId: null,  // Phase 2
    scopeHoverIdx: null,
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const { fmt, sensitivityFromAnalysis, buildProjection, project: projectPure, riskColor, latLonAltToXYZ } = window.IsobarLogic;

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function boot() {
    renderCardSkeletons();
    // Let first paint happen, then run the engine so the skeleton is visible.
    requestAnimationFrame(() => {
      setTimeout(computeAllFlightCards, 30);
    });
    wireLandingEvents();
    wireFlightViewEvents();
    wireModalEvents();
  }

  async function computeAllFlightCards() {
    const keys = window.ContrailEngine.DEMO_FLIGHT_KEYS;
    for (const key of keys) {
      // Await sequentially (each resolves in well under a frame) so the
      // skeleton-to-card fill reads as a deliberate reveal, not a flash.
      try {
        const analysis = await window.ContrailEngine.analyzeDemoFlight(key);
        state.cache[key] = analysis;
        renderFlightCard(key, analysis);
      } catch (err) {
        renderFlightCardError(key, err);
      }
    }
    state.cardsReady = true;
    document.dispatchEvent(new CustomEvent("cardsready"));
  }

  function renderFlightCardError(key, err) {
    const el = document.querySelector(`.flight-card[data-key="${key}"]`);
    if (!el) return;
    el.setAttribute("aria-busy", "false");
    el.innerHTML = `<div class="empty-note">This flight cannot currently be reconstructed from the selected data source.<br><span class="dim mono" style="font-size:10px;">${(err && err.message) || "unknown error"}</span></div>`;
  }

  // ---------------------------------------------------------------------
  // Landing — flight cards
  // ---------------------------------------------------------------------
  function renderCardSkeletons() {
    const grid = $("#flightGrid");
    grid.innerHTML = window.ContrailEngine.DEMO_FLIGHT_KEYS
      .map(
        (key) => `
      <div class="flight-card" data-key="${key}" aria-busy="true" role="listitem" tabindex="-1">
        <div class="skel" style="height:22px;width:70%;margin-bottom:10px;"></div>
        <div class="skel" style="height:13px;width:50%;margin-bottom:16px;"></div>
        <div class="skel" style="height:13px;width:90%;margin-bottom:8px;"></div>
        <div class="skel" style="height:13px;width:60%;"></div>
      </div>`
      )
      .join("");
  }

  

  function renderFlightCard(key, analysis) {
    const el = document.querySelector(`.flight-card[data-key="${key}"]`);
    if (!el) return;
    const f = analysis.flight;
    const durationMin = Math.round(
      (new Date(f.arrivalTime) - new Date(f.departureTime)) / 60000
    );
    const sens = sensitivityFromAnalysis(analysis);
    const hasWindow = analysis.criticalWindows.length > 0;
    el.setAttribute("aria-busy", "false");
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `Replay flight ${f.origin} to ${f.destination}, ${f.aircraft.displayName}, ${sens} contrail sensitivity`);
    el.innerHTML = `
      <div class="route">${f.origin}<span class="arrow">→</span>${f.destination}</div>
      <div class="aircraft">${f.aircraft.displayName} · ${f.callsign}</div>
      <div class="meta-row">
        <span>${Math.floor(durationMin / 60)}h ${durationMin % 60}m</span>
        <span class="sensitivity-badge ${sens}">${sens} sensitivity</span>
      </div>
      <div class="impact-line">${
        hasWindow
          ? `Modeled impact: ${fmt.tj(analysis.baselineTotalImpactJ)} &middot; critical window found`
          : `Modeled impact: negligible &middot; no critical window`
      }</div>
      <div class="replay-cta"><span>Replay flight</span><span>→</span></div>
    `;
  }

  function wireLandingEvents() {
    $("#flightGrid").addEventListener("click", (e) => {
      const card = e.target.closest(".flight-card");
      if (!card || card.getAttribute("aria-busy") === "true") return;
      openFlight(card.dataset.key);
    });
    $("#flightGrid").addEventListener("keydown", (e) => {
      const card = e.target.closest(".flight-card");
      if (!card || card.getAttribute("aria-busy") === "true") return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openFlight(card.dataset.key);
      }
    });
    $("#exploreBtn").addEventListener("click", () => {
      $("#flightSelect").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("#howItWorksBtn").addEventListener("click", () => openExplainModal("overview"));
    $$(".brand").forEach((b) => {
      b.addEventListener("click", goHome);
      b.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          goHome();
        }
      });
    });
  }

  function goHome() {
    stopPlayback();
    state.view = "landing";
    $("#landingView").classList.add("active");
    $("#flightView").classList.remove("active");
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  function openFlight(key) {
    const analysis = state.cache[key];
    if (!analysis) return;
    state.currentKey = key;
    state.current = analysis;
    state.playIndex = 0;
    state.playing = false;
    state.selectedCfId = null;
    state.satVisible = false;
    state.vizMode = "2d";

    state.view = "flight";
    $("#landingView").classList.remove("active");
    $("#flightView").classList.add("active");
    window.scrollTo({ top: 0 });

    initFlightView(analysis, key);
  }

  // ---------------------------------------------------------------------
  // Flight view — header + scope + timeline + altitude chart + drawer
  // ---------------------------------------------------------------------
  let scopeCanvas, scopeCtx, scopeProj;

  function initFlightView(analysis, key) {
    const f = analysis.flight;
    $("#fvRoute").innerHTML = `${f.origin}<span class="arrow">→</span>${f.destination}`;
    $("#fvSub").textContent = `${f.aircraft.displayName} · ${f.callsign} · ${fmt.date(f.departureTime)} · ${FLIGHT_META[key] ? FLIGHT_META[key].blurb : ""}`;

    scopeCanvas = $("#scopeCanvas");
    scopeCtx = scopeCanvas.getContext("2d");
    scopeProj = buildProjection(analysis.flight.trajectory);
    resizeScopeCanvas();

    renderCriticalWindowPanel(analysis);
    renderAltitudeChart(analysis);
    renderTimelineCriticalMarks(analysis);
    setPlayIndex(0);
    renderDrawer(analysis, 0);
    resetWhatIfPanel(analysis);
    if (window.ParetoView && window.ParetoView.reset) window.ParetoView.reset(state);

    // 3D globe degrades gracefully: only enabled when WebGL + the globe
    // module actually initialized successfully (spec section 29 — the app
    // must remain fully usable without WebGL).
    const threeDBtn = $(".scope-mode-btn[data-mode='3d']");
    const globeOk = !!(window.GlobeView && window.GlobeView.available());
    threeDBtn.disabled = !globeOk;
    threeDBtn.title = globeOk ? "" : "3D globe unavailable (WebGL not supported in this browser)";
    $("#satToggleBtn").classList.remove("active");
    $("#legendSat").classList.add("hidden");
    setVizMode("2d");
  }

  function resizeScopeCanvas() {
    if (!scopeCanvas) return;
    const rect = scopeCanvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    scopeCanvas.width = rect.width * dpr;
    scopeCanvas.height = 420 * dpr;
    scopeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scopeProj.w = rect.width;
    scopeProj.h = 420;
    drawScope();
  }
  window.addEventListener("resize", () => {
    resizeScopeCanvas();
    if (window.GlobeView) window.GlobeView.resize();
  });

  function project(lat, lon) {
    return projectPure(scopeProj, lat, lon);
  }

  function drawScope() {
    if (!scopeCtx || !state.current) return;
    const { w, h } = scopeProj;
    const ctx = scopeCtx;
    ctx.clearRect(0, 0, w, h);

    // range rings
    const cx = w / 2, cy = h / 2;
    const maxR = Math.min(w, h) / 2 - 20;
    ctx.strokeStyle = "rgba(140,190,230,0.10)";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (maxR * i) / 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    // spokes
    ctx.strokeStyle = "rgba(140,190,230,0.06)";
    for (let a = 0; a < 360; a += 30) {
      const rad = (a * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(rad) * maxR, cy + Math.sin(rad) * maxR);
      ctx.stroke();
    }

    const traj = state.current.flight.trajectory;
    const annotated = state.current.baselineAnnotated;

    // route, colored by risk per segment
    for (let i = 0; i < traj.length - 1; i++) {
      const a = project(traj[i].latitude, traj[i].longitude);
      const b = project(traj[i + 1].latitude, traj[i + 1].longitude);
      const sample = annotated[i] ? annotated[i].sample : null;
      ctx.strokeStyle = riskColor(sample, 0.9);
      ctx.lineWidth = sample && sample.segmentEnergyForcingJ > 0 ? 2.6 : 1.4;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // critical window glow
    state.current.criticalWindows.forEach((cw) => {
      ctx.save();
      ctx.shadowColor = "rgba(242,161,84,0.9)";
      ctx.shadowBlur = 8;
      ctx.strokeStyle = "rgba(242,161,84,0.95)";
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      for (let i = cw.startIndex; i <= cw.endIndex && i < traj.length; i++) {
        const pt = project(traj[i].latitude, traj[i].longitude);
        if (i === cw.startIndex) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
      ctx.restore();
    });

    // origin / destination markers
    const o = project(traj[0].latitude, traj[0].longitude);
    const d = project(traj[traj.length - 1].latitude, traj[traj.length - 1].longitude);
    [o, d].forEach((p) => {
      ctx.fillStyle = "rgba(200,215,225,0.8)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.font = "10px " + getComputedStyle(document.body).getPropertyValue("--mono");
    ctx.fillStyle = "rgba(170,190,205,0.7)";
    ctx.fillText(state.current.flight.origin, o.x + 7, o.y - 7);
    ctx.fillText(state.current.flight.destination, d.x + 7, d.y - 7);

    // aircraft position (actual)
    const idx = Math.min(state.playIndex, traj.length - 1);
    const cur = project(traj[idx].latitude, traj[idx].longitude);
    drawAircraft(cur, traj, idx, "#6fb8ff");

    // counterfactual overlay
    if (state.selectedCf) {
      drawCounterfactualOverlay(state.selectedCf, idx);
    }

    // synthetic satellite-observation layer (spec section 32/33) — small
    // offset ticks so they read as a distinct, separate layer from the
    // model-colored route line, never merged into one "authoritative" line.
    if (state.satVisible && window.SatelliteLayer) {
      const detections = window.SatelliteLayer.computeDetections(state.current);
      ctx.save();
      for (let i = 0; i < traj.length - 1; i++) {
        if (!detections[i] || !detections[i].observed) continue;
        const a2 = project(traj[i].latitude, traj[i].longitude);
        const b2 = project(traj[i + 1].latitude, traj[i + 1].longitude);
        const mx = (a2.x + b2.x) / 2, my = (a2.y + b2.y) / 2;
        const dx = b2.x - a2.x, dy = b2.y - a2.y;
        const len = Math.hypot(dx, dy) || 1;
        const ox = (-dy / len) * 7, oy = (dx / len) * 7;
        ctx.fillStyle = "rgba(201,139,242,0.85)";
        ctx.beginPath();
        ctx.arc(mx + ox, my + oy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // HUD text
    const pt = traj[idx];
    const sample = annotated[idx] ? annotated[idx].sample : null;
    $("#hudAlt").textContent = "FL" + Math.round(pt.altitudeFt / 100).toString().padStart(3, "0");
    $("#hudTime").textContent = fmt.clock(pt.timestamp);
    $("#hudRisk").textContent = sample
      ? sample.persistentContrailProbability !== null
        ? "P(persist) " + fmt.pct0(sample.persistentContrailProbability)
        : "no SAC/ISSR"
      : "—";
  }

  function drawAircraft(p, traj, idx, color) {
    const ctx = scopeCtx;
    const next = traj[Math.min(idx + 1, traj.length - 1)];
    const cur = traj[idx];
    const heading = Math.atan2(
      project(next.latitude, next.longitude).x - p.x,
      -(project(next.latitude, next.longitude).y - p.y)
    );
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(heading);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawCounterfactualOverlay(cf, idx) {
    const ctx = scopeCtx;
    const traj = cf.modifiedTrajectory;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = "rgba(242,161,84,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    traj.forEach((pt, i) => {
      const p = project(pt.latitude, pt.longitude);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    const cIdx = Math.min(idx, traj.length - 1);
    const cp = project(traj[cIdx].latitude, traj[cIdx].longitude);
    drawAircraft(cp, traj, cIdx, "#f2a154");
  }

  // ---------------------------------------------------------------------
  // Timeline / transport controls
  // ---------------------------------------------------------------------
  function renderTimelineCriticalMarks(analysis) {
    const track = $("#timelineTrack");
    $$(".timeline-critical", track).forEach((n) => n.remove());
    const total = analysis.flight.trajectory.length - 1;
    analysis.criticalWindows.forEach((cw) => {
      const mark = document.createElement("div");
      mark.className = "timeline-critical";
      mark.style.left = (cw.startIndex / total) * 100 + "%";
      mark.style.width = Math.max(((cw.endIndex - cw.startIndex) / total) * 100, 0.6) + "%";
      track.appendChild(mark);
    });
    $("#timelineInput").max = String(total);
  }

  function setPlayIndex(idx) {
    if (!state.current) return;
    const total = state.current.flight.trajectory.length - 1;
    state.playIndex = Math.max(0, Math.min(idx, total));
    $("#timelineInput").value = String(state.playIndex);
    const pct = (state.playIndex / total) * 100;
    $("#timelineFill").style.width = pct + "%";
    $("#timelineThumb").style.left = pct + "%";
    const pt = state.current.flight.trajectory[state.playIndex];
    $("#timeReadout").textContent = fmt.clock(pt.timestamp);
    render();
    renderDrawer(state.current, state.playIndex);
    updateAltChartCursor();
  }

  function stopPlayback() {
    state.playing = false;
    if (state.playTimer) clearInterval(state.playTimer);
    $("#playBtn").innerHTML = playIcon();
    $("#playBtn").setAttribute("aria-pressed", "false");
    $("#playBtn").setAttribute("aria-label", "Play replay");
  }

  function togglePlay() {
    if (!state.current) return;
    state.playing = !state.playing;
    $("#playBtn").innerHTML = state.playing ? pauseIcon() : playIcon();
    $("#playBtn").setAttribute("aria-pressed", String(state.playing));
    $("#playBtn").setAttribute("aria-label", state.playing ? "Pause replay" : "Play replay");
    if (state.playing) {
      const total = state.current.flight.trajectory.length - 1;
      if (state.playIndex >= total) state.playIndex = 0;
      state.playTimer = setInterval(() => {
        if (state.playIndex >= total) {
          stopPlayback();
          return;
        }
        setPlayIndex(state.playIndex + Math.max(1, Math.round(total / 240)));
      }, 45);
    } else {
      clearInterval(state.playTimer);
    }
  }

  function playIcon() {
    return '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1l9 5-9 5V1z" fill="currentColor"/></svg>';
  }
  function pauseIcon() {
    return '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10" fill="currentColor"/><rect x="7" y="1" width="3" height="10" fill="currentColor"/></svg>';
  }

  function wireFlightViewEvents() {
    $("#playBtn").addEventListener("click", togglePlay);
    $("#restartBtn").addEventListener("click", () => {
      stopPlayback();
      setPlayIndex(0);
    });
    $("#timelineInput").addEventListener("input", (e) => {
      stopPlayback();
      setPlayIndex(parseInt(e.target.value, 10));
    });
    $("#jumpCriticalBtn").addEventListener("click", () => {
      if (!state.current || !state.current.criticalWindows.length) return;
      stopPlayback();
      const cw = state.current.criticalWindows[0];
      setPlayIndex(cw.startIndex);
    });
    $("#scopeModeToggle").addEventListener("click", (e) => {
      const btn = e.target.closest(".scope-mode-btn");
      if (!btn || btn.disabled) return;
      if (btn.dataset.mode === "sat") {
        state.satVisible = !state.satVisible;
        btn.classList.toggle("active", state.satVisible);
        btn.setAttribute("aria-pressed", String(state.satVisible));
        $("#legendSat").classList.toggle("hidden", !state.satVisible);
        render();
        return;
      }
      setVizMode(btn.dataset.mode);
    });
  }

  function setVizMode(mode) {
    if (!window.GlobeView || !window.GlobeView.available()) mode = "2d";
    state.vizMode = mode;
    $$(".scope-mode-btn[data-mode='2d'],.scope-mode-btn[data-mode='3d']").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === mode);
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    });
    $("#scopeCanvas").classList.toggle("hidden", mode !== "2d");
    $("#globeCanvas").classList.toggle("hidden", mode !== "3d");
    if (mode === "3d") {
      window.GlobeView.activate(state.current, state.playIndex, state.selectedCf, state.satVisible);
    } else if (window.GlobeView) {
      window.GlobeView.deactivate();
    }
    render();
  }

  function render() {
    if (state.vizMode === "3d" && window.GlobeView) {
      window.GlobeView.update(state.playIndex, state.selectedCf, state.satVisible);
    } else {
      drawScope();
    }
  }

  // ---------------------------------------------------------------------
  // Altitude profile chart (SVG)
  // ---------------------------------------------------------------------
  let altChartMeta = null;

  function renderAltitudeChart(analysis) {
    const svg = $("#altChart");
    const traj = analysis.flight.trajectory;
    const W = 1000, H = 110, padL = 4, padR = 4, padT = 10, padB = 16;
    const maxAlt = Math.max(38000, ...traj.map((p) => p.altitudeFt));
    const n = traj.length;
    const x = (i) => padL + (i / (n - 1)) * (W - padL - padR);
    const y = (alt) => padT + (1 - alt / maxAlt) * (H - padT - padB);
    altChartMeta = { x, y, W, H, n };

    let path = "M";
    traj.forEach((p, i) => {
      path += `${i === 0 ? "" : "L"}${x(i).toFixed(1)},${y(p.altitudeFt).toFixed(1)} `;
    });

    let windowRects = "";
    analysis.criticalWindows.forEach((cw) => {
      const x1 = x(cw.startIndex), x2 = x(cw.endIndex);
      windowRects += `<rect x="${x1}" y="${padT}" width="${Math.max(x2 - x1, 2)}" height="${H - padT - padB}" fill="var(--warn)" opacity="0.14"/>`;
    });

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = `
      <line x1="${padL}" y1="${y(30000)}" x2="${W - padR}" y2="${y(30000)}" stroke="var(--panel-border)" stroke-width="1" stroke-dasharray="3,3"/>
      <text x="${padL}" y="${y(30000) - 4}" font-family="var(--mono)" font-size="8.5" fill="var(--text-dim)">FL300</text>
      ${windowRects}
      <path d="${path}" fill="none" stroke="var(--actual)" stroke-width="1.6"/>
      <line id="altCursor" x1="0" y1="${padT}" x2="0" y2="${H - padB}" stroke="var(--text-0)" stroke-width="1" opacity="0.85"/>
      <circle id="altCursorDot" cx="0" cy="0" r="3" fill="var(--accent)"/>
    `;
  }

  function updateAltChartCursor() {
    if (!altChartMeta || !state.current) return;
    const { x, y } = altChartMeta;
    const idx = state.playIndex;
    const pt = state.current.flight.trajectory[idx];
    const cx = x(idx), cy = y(pt.altitudeFt);
    const cursor = $("#altCursor"), dot = $("#altCursorDot");
    if (cursor) { cursor.setAttribute("x1", cx); cursor.setAttribute("x2", cx); }
    if (dot) { dot.setAttribute("cx", cx); dot.setAttribute("cy", cy); }
  }

  // ---------------------------------------------------------------------
  // Analysis drawer — atmospheric conditions + critical window panel
  // ---------------------------------------------------------------------
  function renderDrawer(analysis, idx) {
    const sample = analysis.baselineAnnotated[idx] ? analysis.baselineAnnotated[idx].sample : null;
    const box = $("#atmoPanel");
    if (!sample) {
      box.innerHTML = `<div class="empty-note">No atmospheric sample at this waypoint.</div>`;
      return;
    }
    const forming = sample.sac === 1 && sample.issr === 1;
    box.innerHTML = `
      <div class="stat-row"><span class="k">Flight level</span><span class="v">FL${sample.flightLevel}</span></div>
      <div class="stat-row"><span class="k">Ambient temperature</span><span class="v">${(sample.temperatureK - 273.15).toFixed(1)}&deg;C</span></div>
      <div class="stat-row"><span class="k">RH over ice</span><span class="v">${sample.relativeHumidityIcePct.toFixed(0)}%</span></div>
      <div class="stat-row"><span class="k">Schmidt-Appleman</span><span class="v ${sample.sac ? "warn" : ""}">${sample.sac === null ? "n/a" : sample.sac ? "criterion met" : "not met"}</span></div>
      <div class="stat-row"><span class="k">Ice-supersaturated</span><span class="v ${sample.issr ? "warn" : ""}">${sample.issr === null ? "n/a" : sample.issr ? "yes (ISSR)" : "no"}</span></div>
      <div class="stat-row"><span class="k">Persistent contrail</span><span class="v ${forming ? "warn" : ""}">${sample.persistentContrailProbability === null ? "—" : fmt.pct0(sample.persistentContrailProbability)}</span></div>
      <div class="stat-row"><span class="k">Segment forcing</span><span class="v ${sample.segmentEnergyForcingJ > 0 ? "warn" : sample.segmentEnergyForcingJ < 0 ? "good" : ""}">${sample.segmentEnergyForcingJ === null ? "—" : (sample.segmentEnergyForcingJ / 1e9).toFixed(1) + " GJ"}</span></div>
      <div class="stat-row"><span class="k">Confidence</span><span class="conf-badge ${sample.confidence}">${sample.confidence}</span></div>
    `;
  }

  function renderCriticalWindowPanel(analysis) {
    const box = $("#criticalWindowPanel");
    if (!analysis.criticalWindows.length) {
      box.innerHTML = `<div class="empty-note">No concentrated contrail-sensitive window was detected along this trajectory. Conditions stayed below the persistent-contrail threshold for essentially the whole flight — this is a genuine "clear" case, not missing data.</div>`;
      return;
    }
    const cw = analysis.criticalWindows[0];
    const durMin = Math.round(cw.durationSec / 60);
    box.innerHTML = `
      <div class="critical-window-box" id="cwJumpBox">
        <div class="cw-title">Most important window</div>
        <div class="cw-range">${fmt.clock(cw.startTimestamp)} &rarr; ${fmt.clock(cw.endTimestamp)} <span class="dim mono" style="font-size:11px;">(${durMin} min)</span></div>
        <div class="cw-desc">This segment contains <strong>${fmt.pct0(cw.shareOfFlightImpact)}</strong> of the flight's modeled contrail impact. Confidence: ${cw.confidence}.</div>
      </div>
    `;
    $("#cwJumpBox").addEventListener("click", () => {
      stopPlayback();
      setPlayIndex(cw.startIndex);
    });
  }

  // ---------------------------------------------------------------------
  // Explanation modal (Phase 1: overview only; Phase 2 adds per-result)
  // ---------------------------------------------------------------------
  function wireModalEvents() {
    $("#modalBackdrop").addEventListener("click", (e) => {
      if (e.target.id === "modalBackdrop") closeModal();
    });
    $("#modalClose").addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      closeModal();
      const pb = $("#paretoBackdrop");
      if (pb && pb.classList.contains("open")) pb.classList.remove("open");
    });
  }
  function closeModal() {
    $("#modalBackdrop").classList.remove("open");
  }
  window.openExplainModal = function (mode) {
    const body = $("#modalBody");
    $("#modalTitle").textContent = "How this works";
    body.innerHTML = `
      <div class="explain-flow">
        <div class="explain-step"><span class="es-k">Flight data</span><span class="es-v">Reconstructed representative trajectory (real city pair &amp; aircraft type, great-circle route, documented phase-of-flight profile) — not raw recorded telemetry.</span></div>
        <div class="explain-step"><span class="es-k">Atmosphere</span><span class="es-v">Synthetic field using real ICAO Standard Atmosphere temperature + Schmidt-Appleman / ISSR logic, with energy-forcing magnitudes drawn from documented CoCiP percentile distributions.</span></div>
        <div class="explain-step"><span class="es-k">Critical window</span><span class="es-v">Segments are aggregated by contiguous positive energy forcing to find where impact concentrates — not just the single highest point.</span></div>
        <div class="explain-step"><span class="es-k">Counterfactual</span><span class="es-v">Kinematically-continuous altitude ramps (no instantaneous jumps), re-sampled against the same atmospheric field.</span></div>
        <div class="explain-step"><span class="es-k">Operational cost</span><span class="es-v">Simplified parabolic fuel model + constant-Mach time delta. Not a certified aircraft performance model.</span></div>
        <div class="explain-step"><span class="es-k">3D globe</span><span class="es-v">Same underlying data as the 2D scope, rendered on a grid-line globe (no real coastline/terrain data used, by design) — an alternate view, not a different model.</span></div>
        <div class="explain-step"><span class="es-k">Satellite layer</span><span class="es-v"><strong>Synthetic and illustrative</strong> — this build has no network access to any real satellite-derived contrail product. The violet markers are a deterministic, documented stand-in showing partial (not perfect) agreement with the model, to demonstrate the model-vs-observation distinction described in the methodology. They are not real imagery and are not attributed to any aircraft.</span></div>
      </div>
      <div class="limitations-title">Important limitations</div>
      <ul class="limitations-list">
        <li>Atmospheric data is a physically-grounded synthetic approximation, not a live weather model run.</li>
        <li>Trajectory is reconstructed and representative, not recorded ADS-B telemetry.</li>
        <li>Fuel/CO&sub2;/time deltas use a simplified, documented operational model.</li>
        <li>This is an experimental analysis tool — not flight-dispatch or safety guidance.</li>
      </ul>
    `;
    $("#modalBackdrop").classList.add("open");
  };

  function resetWhatIfPanel() {
    // Phase 2 will populate this. Placeholder no-op kept so initFlightView
    // can call it unconditionally without knowing which phase is loaded.
    if (window.WhatIf && window.WhatIf.reset) window.WhatIf.reset(state, els());
  }

  function els() {
    return { $, $$, fmt, drawScope: () => render() };
  }

  // Expose minimal shared surface for Phase 2/3 modules.
  window.ContrailApp = { state, $, $$, fmt, drawScope: () => render(), setPlayIndex, stopPlayback, riskColor };

  document.addEventListener("DOMContentLoaded", boot);
})();
