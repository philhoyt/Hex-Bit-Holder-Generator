// The page: state, the plan view, the panel, the 3D view, downloads. Everything that touches the DOM lives here.
import { DEFAULTS, FIT_KEYS, ROW_LIMITS, makeRow, createState, restoreState, clampTo } from "./state.js";
import { LABEL } from "./font.js";
import { buildHolder, hexPoints } from "./geometry.js";
import { createExport, zip } from "./export.js";

(function () {
  "use strict";

  // ================================================================ state
  var KEY = "hbh-state-v1", nextId = 1;
  function newRow(opts) { return makeRow(nextId++, opts); }
  var S = createState();
  try { nextId = restoreState(S, JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) { /* no usable storage: start fresh */ }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full or blocked: keep going */ } }

  var $ = function (id) { return document.getElementById(id); };
  function sel() { for (var i = 0; i < S.rows.length; i++) if (S.rows[i].id === S.selId) return S.rows[i]; return null; }
  function idx(r) { return S.rows.indexOf(r) + 1; }
  function f1(v) { return (Math.round(v * 10) / 10).toString(); }
  var status = $("status"), undoBtn = $("undo");
  var undo = null; // one step back from the last delete, empty, or starter set
  function say(t) { status.textContent = t; undo = null; undoBtn.hidden = true; }
  function sayUndo(t, u) { status.textContent = t; undo = u; undoBtn.hidden = false; }
  function doUndo() {
    var u = undo; if (!u) return;
    if (u.row) { S.rows.splice(Math.min(u.index, S.rows.length), 0, u.row); S.selId = u.row.id; }
    else { S.rows = u.rows; S.selId = u.selId; }
    say(u.undone); update();
  }
  undoBtn.addEventListener("click", doUndo);
  function snapshot(undone) { return { rows: S.rows, selId: S.selId, undone: undone }; }

  var ex = createExport(S);
  var model = null; // the layout for the current state, rebuilt on every update

  // ================================================================ plan view
  var svgNS = "http://www.w3.org/2000/svg", plan = $("plan");
  function el(tag, attrs, parent) { var e = document.createElementNS(svgNS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function drawPlan() {
    plan.innerHTML = "";
    var M = model, pad = 8, W = Math.max(M.W, 30), D = Math.max(M.D, 16);
    plan.setAttribute("viewBox", (-pad) + " " + (-pad) + " " + (W + 2 * pad) + " " + (D + 2 * pad + 4));
    var Y = function (y) { return D - y; }; // front row at the bottom, like the 3D view
    if (!S.rows.length) {
      el("rect", { x: 0, y: 0, width: W, height: D, rx: M.r, class: "body", "stroke-dasharray": "2 1.5", style: "fill:transparent" }, plan);
      return;
    }
    el("rect", { x: 0, y: 0, width: M.W, height: M.D, rx: M.r, class: "body" }, plan);
    M.rows.forEach(function (r, k) {
      var row = S.rows[k], on = row.id === S.selId;
      if (M.slots) el("rect", { x: -0.5, y: Y(r.b), width: M.W + 1, height: M.s, class: "slot" }, plan);
      r.holes.forEach(function (h) {
        var pts = hexPoints(h.x, r.y, h.ir).map(function (p) { return p.x + "," + Y(p.y); }).join(" ");
        var g = el("polygon", { points: pts, class: "hole" + (on ? " on" : ""), "data-id": row.id }, plan);
        g.addEventListener("click", function () { S.selId = row.id; update(); });
        if (h.shown) el("text", { x: h.x, y: Y(h.labelY) + h.cap * 0.35, "font-size": h.cap, class: "lbl" + (on ? " on" : "") }, plan).textContent = h.shown;
      });
      var band = el("rect", { x: 0, y: Y(r.y + r.ir + 1), width: M.W, height: 2 * r.ir + 2 + r.band, class: "row-band" }, plan);
      band.addEventListener("click", function () { S.selId = row.id; update(); });
      el("text", { x: -4, y: Y(r.y) + 1.6, "font-size": 4.5, class: "row-num" }, plan).textContent = k + 1;
    });
    el("text", { x: M.W / 2, y: D + pad - 1, "font-size": 3, class: "axis" }, plan).textContent = "FRONT · " + f1(M.W) + " × " + f1(M.D) + " mm";
  }

  // ================================================================ downloads
  var downloadsP = (window.claude && window.claude.use) ? window.claude.use("downloads").catch(function () { return null; }) : Promise.resolve(null);
  function save(filename, blob, doneMsg) {
    say("Preparing " + filename + "…");
    downloadsP.then(function (dl) {
      if (!dl) { // plain browser (GitHub Pages, local file): normal download link
        try {
          var url = URL.createObjectURL(blob), a = document.createElement("a");
          a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          say(doneMsg);
        } catch (e) { say("Couldn't start the download in this browser."); }
        return;
      }
      return dl.save({ filename: filename, data: blob }).then(function () { say(doneMsg); }, function (err) {
        var c = err && err.code;
        say(c === "declined" ? "Download canceled." : c === "rate_limited" ? "A save prompt is already open. Finish that one first." : "Couldn't save the file here (" + (c || "error") + ").");
      });
    });
  }
  $("dlStl").addEventListener("click", function () {
    if (!S.rows.length) return;
    var f = ex.stlFile();
    save(f.name, new Blob([f.data], { type: "model/stl" }), "Saved " + f.name + ". Print it flat, no supports.");
  });
  $("fitTest").addEventListener("click", function () {
    var z = ex.fitTestFiles();
    save(z.name, zip(z.files), "Saved " + z.name + ": one strip of four holes and a README.");
  });

  // ================================================================ 3D view
  var three = null, geoCache = {};
  function initThree() {
    var stage = $("stage");
    function fail() {
      var d = document.createElement("div"); d.className = "err"; d.textContent = "3D preview couldn't load. The plan view and downloads still work.";
      stage.appendChild(d);
    }
    if (!window.THREE || !THREE.OrbitControls) { fail(); return; }
    var renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch (e) { fail(); return; } // no WebGL context (headless, disabled GPU, old browser)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    stage.insertBefore(renderer.domElement, stage.firstChild);
    var scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 4 / 3, 1, 6000);
    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.12;
    controls.minDistance = 20; controls.maxDistance = 1200; controls.maxPolarAngle = Math.PI / 2 - 0.04;
    renderer.domElement.addEventListener("dblclick", function () { resetView(); });
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6450, 0.85));
    var key = new THREE.DirectionalLight(0xffffff, 0.75); key.position.set(160, 300, 220); scene.add(key);
    var fill = new THREE.DirectionalLight(0xffffff, 0.25); fill.position.set(-220, 90, -140); scene.add(fill);
    var world = new THREE.Group(); scene.add(world);
    var grid = new THREE.GridHelper(600, 60, 0x888888, 0x888888); grid.material.transparent = true; grid.material.opacity = 0.16; grid.position.y = -0.2; scene.add(grid);
    three = {
      renderer: renderer, scene: scene, camera: camera, controls: controls, world: world,
      mat: new THREE.MeshStandardMaterial({ color: 0xE8671B, roughness: 0.6, flatShading: true }),
      lineMat: new THREE.LineBasicMaterial({ color: 0x4a2008, transparent: true, opacity: 0.45 })
    };
    function fitStage() { var w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    new ResizeObserver(fitStage).observe(stage); fitStage();
    (function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();
  }
  function geoFor() {
    var k = JSON.stringify(Object.assign({}, S, { selId: 0 }));
    if (!geoCache[k]) {
      var tris = buildHolder(model), pos = new Float32Array(tris.length * 9), o = 0;
      tris.forEach(function (t) { for (var i = 0; i < 3; i++) { pos[o++] = t[i][0]; pos[o++] = t[i][1]; pos[o++] = t[i][2]; } });
      var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
      geoCache[k] = { mesh: g, edges: new THREE.EdgesGeometry(g, 35) };
    }
    return geoCache[k];
  }
  var lastFrame = "";
  function resetView() {
    if (three) { three.controls.enableDamping = false; three.controls.update(); three.controls.enableDamping = true; }
    lastFrame = ""; show3D();
  }
  function show3D() {
    if (!three) return;
    while (three.world.children.length) three.world.remove(three.world.children[0]);
    if (Object.keys(geoCache).length > 60) { // the scene is empty here, so nothing still uses these buffers
      Object.keys(geoCache).forEach(function (k) { geoCache[k].mesh.dispose(); geoCache[k].edges.dispose(); });
      geoCache = {};
    }
    if (!S.rows.length) return;
    var G = geoFor(), inner = new THREE.Group();
    inner.rotation.x = -Math.PI / 2; // model z up; model y (front to back) runs away from the camera
    inner.position.set(-model.W / 2, 0, model.D / 2);
    inner.add(new THREE.Mesh(G.mesh, three.mat), new THREE.LineSegments(G.edges, three.lineMat));
    three.world.add(inner);
    var frameKey = [Math.round(model.W / 10), Math.round(model.D / 10), Math.round(model.H / 5)].join("|");
    if (frameKey !== lastFrame) {
      lastFrame = frameKey;
      var sp = Math.max(model.W, model.D * 1.3, model.H * 2), dist = sp * 1.7 + 30;
      three.camera.position.set(dist * 0.35, dist * 0.6, dist * 0.78);
      three.controls.target.set(0, model.H * 0.3, 0);
      three.controls.update();
    }
  }

  // ================================================================ UI
  function setPressed(attr, val) { document.querySelectorAll("[data-" + attr + "]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-" + attr) === val)); }); }
  function drawList() {
    var ol = $("rowlist"); ol.innerHTML = "";
    S.rows.forEach(function (r) {
      var li = document.createElement("li"); li.tabIndex = 0; if (r.id === S.selId) li.className = "on";
      li.innerHTML = '<span class="num">' + idx(r) + '</span><span class="what">' + ex.describe(r) + "<small>" + (idx(r) === 1 ? "front row" : idx(r) === S.rows.length ? "back row" : "") + '</small></span><button type="button" class="del" aria-label="Delete row ' + idx(r) + '">×</button>';
      li.addEventListener("click", function (e) { if (e.target.classList.contains("del")) { removeRow(r.id); return; } S.selId = r.id; update(); });
      li.addEventListener("keydown", function (e) {
        if (e.target.classList.contains("del")) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); S.selId = r.id; update(); }
      });
      ol.appendChild(li);
    });
    $("emptyNote").hidden = S.rows.length > 0;
  }
  function removeRow(id) {
    var i = S.rows.findIndex(function (r) { return r.id === id; }); if (i < 0) return;
    var gone = S.rows.splice(i, 1)[0], label = "row " + (i + 1) + " (" + ex.describe(gone) + ")";
    if (S.selId === id) S.selId = S.rows.length ? S.rows[Math.min(i, S.rows.length - 1)].id : null;
    sayUndo("Deleted " + label + ".", { row: gone, index: i, undone: "Restored " + label + "." });
    update();
  }
  function addRow(opts, after) {
    if (S.rows.length >= ROW_LIMITS.maxRows) { say("That's the most rows the holder takes."); return; }
    var base = sel(), o = Object.assign({}, opts);
    if (base && o.size === undefined) { o.size = base.size; o.custom = base.custom; o.count = base.count; }
    var nr = newRow(o), at = after ? S.rows.indexOf(after) + 1 : S.rows.length;
    S.rows.splice(at, 0, nr); S.selId = nr.id; say(""); update();
  }

  function updateHeader() {
    var code = $("code"), r = sel();
    code.textContent = ex.codeOf(); code.classList.toggle("empty", !S.rows.length);
    $("codeMeta").innerHTML = S.rows.length ? "<span><b>" + ex.sizeSummary() + "</b> bits · " + model.holes.length + " holes</span><span><b>" + f1(model.W) + " × " + f1(model.D) + " × " + f1(model.H) + "</b> mm</span>" : "<span>Add a row of holes to begin.</span>";
    if (!r) return;
  }
  var gridFor = "", labelNotes = [];
  function fitNote(h) {
    if (!h.text) return "";
    if (!h.shown) return "no room for a label here";
    return f1(h.cap) + " mm letters" + (h.dropped ? " · " + h.shown.length + " of " + h.text.length + " fit" : "");
  }
  function renderLabelGrid(r) {
    var box = $("labelGrid"), sig = r.id + "|" + r.count, row = model.rows[S.rows.indexOf(r)];
    if (sig !== gridFor) { // rebuild the cells only when the row changes shape, so typing keeps focus
      gridFor = sig; box.innerHTML = "";
      for (var i = 0; i < r.count; i++) {
        var inp = document.createElement("input"); inp.type = "text"; inp.className = "cell"; inp.maxLength = LABEL.maxLen; inp.autocomplete = "off"; inp.spellcheck = false;
        inp.dataset.i = i; inp.placeholder = i === 0 ? "PH2" : ""; inp.setAttribute("aria-label", "Label for hole " + (i + 1));
        box.appendChild(inp);
      }
    }
    labelNotes = [];
    box.querySelectorAll(".cell").forEach(function (cell, k) {
      var raw = r.labels[k] || "", h = row.holes[k];
      if (document.activeElement !== cell) cell.value = raw;
      var note = fitNote(h); cell.title = note; cell.classList.toggle("bad", !!(h.text && (!h.shown || h.dropped)));
      labelNotes[k] = note;
    });
    var a = document.activeElement;
    $("label-v").textContent = a && a.classList && a.classList.contains("cell") ? labelNotes[+a.dataset.i] || "" : "";
  }
  function updateRowPanel() {
    var r = sel();
    $("rowGroup").classList.toggle("disabled", !r);
    if (!r) { $("rowWhich").textContent = ""; return; }
    $("rowWhich").textContent = "#" + idx(r) + " · " + ex.describe(r);
    setPressed("size", r.size);
    $("customField").hidden = r.size !== "custom";
    if (document.activeElement !== $("custom")) $("custom").value = r.custom;
    $("count-out").textContent = r.count; $("rows-out").textContent = S.rows.length;
    renderLabelGrid(r);
  }
  function updateHolderPanel() {
    $("height").value = S.height; $("height-v").textContent = f1(S.height) + " mm";
    setPressed("bottom", S.through ? "through" : "closed");
    $("chamfer").value = S.chamfer; $("chamfer-v").textContent = S.chamfer ? f1(model.c) + " mm" + (model.c < S.chamfer - 0.05 ? " (limited by the walls)" : "") : "none";
    setPressed("slots", S.slots ? "on" : "off"); $("slotBox").hidden = !S.slots;
    $("slotPct").value = S.slotPct; $("slotPct-v").textContent = S.slotPct + "% · " + f1(model.H - model.zS) + " mm";
    $("cornerR").value = S.cornerR; $("cornerR-v").textContent = f1(model.r) + " mm" + (model.r < S.cornerR - 0.05 ? " (limited by the edge wall)" : "");
    FIT_KEYS.forEach(function (k) { if (document.activeElement !== $(k)) $(k).value = S[k]; });
  }
  function updateSummary() {
    var r = sel(), M = model, rows = [];
    if (r) {
      var mr = M.rows[S.rows.indexOf(r)];
      rows = [["Hole across flats", f1(2 * mr.holes[0].ir) + " mm"], ["Hole across corners", f1(2 * mr.holes[0].R) + " mm"], ["Hole pitch", f1(mr.pitch) + " mm"], ["Hole depth", f1(M.H - M.zF) + " mm" + (M.through ? " · through" : "")]];
    }
    $("specs").innerHTML = rows.map(function (s) { return '<div class="spec"><span>' + s[0] + "</span><b>" + s[1] + "</b></div>"; }).join("");
    $("summary").textContent = S.rows.length ? S.rows.length + " row" + (S.rows.length > 1 ? "s" : "") + " · " + M.holes.length + " holes · " + f1(M.W) + " × " + f1(M.D) + " × " + f1(M.H) + " mm · " + ex.fileStem() + ".stl" : "Empty holder.";
    $("dlStl").disabled = !S.rows.length; $("copyScad").disabled = !S.rows.length;
  }
  // Redraw everything from S.
  function update() {
    model = ex.model();
    updateHeader(); updateRowPanel(); updateHolderPanel(); updateSummary();
    drawPlan(); drawList(); show3D();
    persist();
  }

  // controls
  $("resetView").addEventListener("click", resetView);
  document.querySelectorAll("[data-size]").forEach(function (x) { x.addEventListener("click", function () { var r = sel(); if (r) { r.size = x.getAttribute("data-size"); if (r.size === "custom" && !(r.custom > 0)) r.custom = 6.35; update(); } }); });
  $("custom").addEventListener("change", function () { var r = sel(), v = parseFloat($("custom").value); if (r && isFinite(v)) { r.custom = Math.min(ROW_LIMITS.custom[1], Math.max(ROW_LIMITS.custom[0], v)); update(); } });
  function bumpCount(d) { var r = sel(); if (!r) return; var v = Math.min(ROW_LIMITS.count[1], Math.max(ROW_LIMITS.count[0], r.count + d)); if (v !== r.count) { r.count = v; r.labels = r.labels.slice(0, v); update(); } }
  $("count-minus").addEventListener("click", function () { bumpCount(-1); });
  $("count-plus").addEventListener("click", function () { bumpCount(1); });
  $("rows-plus").addEventListener("click", function () { addRow({}); });
  $("rows-minus").addEventListener("click", function () { if (S.rows.length) removeRow(S.rows[S.rows.length - 1].id); });
  $("addRow").addEventListener("click", function () { addRow({}); });
  $("dupRow").addEventListener("click", function () { var r = sel(); if (r) addRow({ size: r.size, custom: r.custom, count: r.count, labels: r.labels.slice() }, r); });
  $("delRow").addEventListener("click", function () { var r = sel(); if (r) removeRow(r.id); });
  $("clearLabels").addEventListener("click", function () { var r = sel(); if (r) { r.labels = []; update(); } });
  $("labelGrid").addEventListener("input", function (e) {
    var inp = e.target, r = sel(); if (!inp.classList.contains("cell") || !r) return;
    var i = +inp.dataset.i; while (r.labels.length < i) r.labels.push("");
    r.labels[i] = inp.value.slice(0, LABEL.maxLen);
    while (r.labels.length && !r.labels[r.labels.length - 1]) r.labels.pop();
    update();
  });
  $("labelGrid").addEventListener("focusin", function (e) { if (e.target.classList.contains("cell")) $("label-v").textContent = labelNotes[+e.target.dataset.i] || ""; });
  $("labelGrid").addEventListener("focusout", function () { $("label-v").textContent = ""; });
  ["height", "chamfer", "slotPct", "cornerR"].forEach(function (k) { $(k).addEventListener("input", function () { S[k] = clampTo(k, +$(k).value); update(); }); });
  document.querySelectorAll("[data-bottom]").forEach(function (x) { x.addEventListener("click", function () { S.through = x.getAttribute("data-bottom") === "through"; update(); }); });
  document.querySelectorAll("[data-slots]").forEach(function (x) { x.addEventListener("click", function () { S.slots = x.getAttribute("data-slots") === "on"; update(); }); });
  FIT_KEYS.forEach(function (k) {
    $(k).addEventListener("change", function () { var v = parseFloat($(k).value); if (isFinite(v)) S[k] = clampTo(k, v); update(); });
  });
  $("resetAdv").addEventListener("click", function () { FIT_KEYS.forEach(function (k) { S[k] = DEFAULTS[k]; }); update(); });
  function loadSet(rows, msg) {
    var u = snapshot("Put the previous rows back.");
    S.rows = rows.map(function (o) { return newRow(o); }); S.selId = S.rows.length ? S.rows[0].id : null;
    sayUndo(msg, u); update();
  }
  $("set-std").addEventListener("click", function () { loadSet([{ count: 8 }, { count: 8 }], "Loaded two rows of eight 1/4 in holes."); });
  $("set-mixed").addEventListener("click", function () { loadSet([{ count: 8 }, { size: "4mm", count: 10 }], "Loaded a 1/4 in row and a 4 mm row."); });
  $("set-driver").addEventListener("click", function () {
    loadSet([{ count: 6, labels: ["PH1", "PH2", "PH3", "SL4", "SL6", "SQ2"] }, { count: 6, labels: ["T10", "T15", "T20", "T25", "T30", "H4"] }], "Loaded a labeled driver set.");
  });
  $("clearAll").addEventListener("click", function () { loadSet([], "Holder emptied. Add a row to begin."); });
  document.addEventListener("keydown", function (e) {
    if (/INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || "")) return;
    if (e.key === "Delete" || e.key === "Backspace") { var r = sel(); if (r) { e.preventDefault(); removeRow(r.id); } }
    else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z" && undo) { e.preventDefault(); doUndo(); }
  });
  $("copyScad").addEventListener("click", function () {
    if (!S.rows.length) return;
    var txt = ex.scadText(), box = $("copyFallback");
    function fallback() { box.hidden = false; box.value = txt; box.focus(); box.select(); say("Select and copy the settings below."); }
    try { navigator.clipboard.writeText(txt).then(function () { box.hidden = true; say("Settings copied. Paste them over the settings at the top of hex_bit_holder.scad."); }, fallback); }
    catch (e) { fallback(); }
  });

  function starter() { S.rows = [newRow({ count: 8 }), newRow({ count: 8 })]; S.selId = S.rows[0].id; }
  if (!S.rows.length) { try { if (localStorage.getItem(KEY) === null) starter(); } catch (e) { starter(); } }
  initThree();
  update();
})();
