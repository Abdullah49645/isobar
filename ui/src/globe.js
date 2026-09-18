/* ==========================================================================
   ISOBAR — 3D globe view (spec section 26)
   Built as an enhancement layered on top of the complete, fully-functional
   2D radar scope (never the other way around) — spec section 29 requires
   the app to stay fully usable without WebGL, so this module self-reports
   availability and app.js falls back to 2D whenever it isn't. No real
   coastline/terrain data is used, by design (see the design-system note in
   the original handoff): a grid-line globe keeps the same
   "instrument display, not a map" language as the 2D scope.
   ========================================================================== */
(function () {
  "use strict";

  const RADIUS = 60;
  const ALT_SCALE = 0.00045; // feet -> scene units above the surface

  let ready = false;
  let renderer, scene, camera, canvas;
  let routeGroup, aircraftMesh, cfGroup, satGroup;
  let currentAnalysis = null;
  let rafId = null;
  let active = false;

  // orbit state
  const cam = { azimuth: 0.9, polar: 1.15, distance: 165, target: null };
  let dragging = false, lastX = 0, lastY = 0, idleFrames = 0;

  function available() {
    if (!window.THREE) return false;
    try {
      const test = document.createElement("canvas");
      return !!(test.getContext("webgl") || test.getContext("experimental-webgl"));
    } catch (e) {
      return false;
    }
  }

  function ensureInit() {
    if (ready) return true;
    if (!available()) return false;
    canvas = document.getElementById("globeCanvas");
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);

    buildEarth();
    wireControls();
    ready = true;
    return true;
  }

  function buildEarth() {
    const grid = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS, 28, 20),
      new THREE.MeshBasicMaterial({ color: 0x2c3946, wireframe: true, transparent: true, opacity: 0.4 })
    );
    scene.add(grid);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS - 0.6, 28, 20),
      new THREE.MeshBasicMaterial({ color: 0x060a0f })
    );
    scene.add(core);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS * 1.04, 28, 20),
      new THREE.MeshBasicMaterial({ color: 0x4fd6c8, transparent: true, opacity: 0.05, side: THREE.BackSide })
    );
    scene.add(glow);
  }

  function parseRgba(str) {
    const m = /rgba?\(([^)]+)\)/.exec(str);
    if (!m) return new THREE.Color(0x888888);
    const parts = m[1].split(",").map((s) => parseFloat(s));
    return new THREE.Color(parts[0] / 255, parts[1] / 255, parts[2] / 255);
  }

  function pt3(lat, lon, altFt) {
    const p = window.IsobarLogic.latLonAltToXYZ(lat, lon, altFt, RADIUS, ALT_SCALE);
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  function chunk3(flat) {
    const out = [];
    for (let i = 0; i < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
    return out;
  }

  function buildRoute(analysis) {
    if (routeGroup) {
      scene.remove(routeGroup);
      disposeGroup(routeGroup);
    }
    routeGroup = new THREE.Group();
    const traj = analysis.flight.trajectory;
    const annotated = analysis.baselineAnnotated;

    const positions = [];
    const colors = [];
    for (let i = 0; i < traj.length - 1; i++) {
      const a = pt3(traj[i].latitude, traj[i].longitude, traj[i].altitudeFt);
      const b = pt3(traj[i + 1].latitude, traj[i + 1].longitude, traj[i + 1].altitudeFt);
      const sample = annotated[i] ? annotated[i].sample : null;
      const c = parseRgba(window.IsobarLogic.riskColor(sample, 1));
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 });
    routeGroup.add(new THREE.LineSegments(geo, mat));

    // critical window: raised, glowing amber ribbon
    analysis.criticalWindows.forEach((cw) => {
      const cwPos = [];
      for (let i = cw.startIndex; i <= cw.endIndex && i < traj.length; i++) {
        const p = pt3(traj[i].latitude, traj[i].longitude, traj[i].altitudeFt + 900);
        cwPos.push(p.x, p.y, p.z);
      }
      const pts = chunk3(cwPos).map((v) => new THREE.Vector3(v[0], v[1], v[2]));
      const cwGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const cwMat = new THREE.LineBasicMaterial({ color: 0xf2a154, linewidth: 3, transparent: true, opacity: 0.95 });
      routeGroup.add(new THREE.Line(cwGeo, cwMat));
    });

    // origin/destination markers
    [traj[0], traj[traj.length - 1]].forEach((p) => {
      const pos = pt3(p.latitude, p.longitude, 0);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), new THREE.MeshBasicMaterial({ color: 0xc8d7e1 }));
      dot.position.copy(pos);
      routeGroup.add(dot);
    });

    scene.add(routeGroup);

    if (aircraftMesh) scene.remove(aircraftMesh);
    aircraftMesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 2.6, 6),
      new THREE.MeshBasicMaterial({ color: 0x6fb8ff })
    );
    scene.add(aircraftMesh);

    satGroup = new THREE.Group();
    scene.add(satGroup);

    const mid = traj[Math.floor(traj.length / 2)];
    cam.target = pt3(mid.latitude, mid.longitude, 8000);
  }

  function disposeGroup(group) {
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }

  function orientMarker(mesh, traj, idx) {
    const cur = traj[idx];
    const next = traj[Math.min(idx + 1, traj.length - 1)];
    const pos = pt3(cur.latitude, cur.longitude, cur.altitudeFt);
    const aheadPos = pt3(next.latitude, next.longitude, next.altitudeFt);
    mesh.position.copy(pos);
    mesh.up.copy(pos.clone().normalize());
    mesh.lookAt(aheadPos);
    mesh.rotateX(Math.PI / 2);
  }

  function activate(analysis, idx, selectedCf, satVisible) {
    if (!ensureInit()) return;
    active = true;
    idleFrames = 0;
    if (currentAnalysis !== analysis) {
      buildRoute(analysis);
      currentAnalysis = analysis;
      cam.azimuth = 0.9;
      cam.polar = 1.15;
      cam.distance = RADIUS * 2.7;
    }
    resize();
    update(idx, selectedCf, satVisible);
    if (!rafId) loop();
  }

  function deactivate() {
    active = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function update(idx, selectedCf, satVisible) {
    if (!ready || !currentAnalysis) return;
    const traj = currentAnalysis.flight.trajectory;
    const clampedIdx = Math.min(idx, traj.length - 1);
    orientMarker(aircraftMesh, traj, clampedIdx);

    if (cfGroup) {
      scene.remove(cfGroup);
      disposeGroup(cfGroup);
      cfGroup = null;
    }
    if (selectedCf) {
      cfGroup = new THREE.Group();
      const cfTraj = selectedCf.modifiedTrajectory;
      const pts = cfTraj.map((p) => pt3(p.latitude, p.longitude, p.altitudeFt));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineDashedMaterial({ color: 0xf2a154, dashSize: 1.4, gapSize: 0.8 });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      cfGroup.add(line);
      const cfIdx = Math.min(clampedIdx, cfTraj.length - 1);
      const marker = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.6, 6), new THREE.MeshBasicMaterial({ color: 0xf2a154 }));
      orientMarker(marker, cfTraj, cfIdx);
      cfGroup.add(marker);
      scene.add(cfGroup);
    }

    if (satGroup) {
      while (satGroup.children.length) satGroup.remove(satGroup.children[0]);
      if (satVisible && window.SatelliteLayer) {
        const detections = window.SatelliteLayer.computeDetections(currentAnalysis);
        const dotGeo = new THREE.SphereGeometry(0.5, 6, 6);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xc98bf2 });
        detections.forEach((d) => {
          if (!d.observed) return;
          const p = traj[d.index];
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.position.copy(pt3(p.latitude, p.longitude, p.altitudeFt + 1600));
          satGroup.add(dot);
        });
      }
    }
  }

  function resize() {
    if (!ready || !canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    renderer.setSize(rect.width, 420, false);
    camera.aspect = rect.width / 420;
    camera.updateProjectionMatrix();
  }

  function wireControls() {
    canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      idleFrames = 0;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      cam.azimuth -= dx * 0.006;
      cam.polar = Math.max(0.25, Math.min(Math.PI - 0.25, cam.polar - dy * 0.006));
      idleFrames = 0;
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
      canvas.addEventListener(ev, () => (dragging = false))
    );
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        cam.distance = Math.max(RADIUS * 1.3, Math.min(RADIUS * 6, cam.distance + e.deltaY * 0.08));
        idleFrames = 0;
      },
      { passive: false }
    );
  }

  function loop() {
    if (!active) {
      rafId = null;
      return;
    }
    idleFrames++;
    if (idleFrames > 90) cam.azimuth += 0.0012; // gentle auto-rotate when idle

    const target = cam.target || new THREE.Vector3(0, 0, 0);
    const x = target.x + cam.distance * Math.sin(cam.polar) * Math.cos(cam.azimuth);
    const z = target.z + cam.distance * Math.sin(cam.polar) * Math.sin(cam.azimuth);
    const y = target.y + cam.distance * Math.cos(cam.polar);
    camera.position.set(x, y, z);
    camera.lookAt(target);

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(loop);
  }

  window.GlobeView = { available, activate, deactivate, update, resize };
})();
