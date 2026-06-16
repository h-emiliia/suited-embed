/* ─────────────────────────────────────────────────────────
 * SUITED — scroll-scrubbed Chladni morph (Webflow embed)
 *
 * The hero is pinned while the user scrolls. Scroll progress
 * maps to a pattern position q across the section presets;
 * particles continuously migrate to the interpolated nodal
 * lines — the scrollbar scrubs the morph in both directions.
 *
 *  q = 0   pattern of section 1, label 1 active
 *  q 0→1   dwell, then particles migrate 1 → 2
 *  q = 1   pattern of section 2, label 2 active
 *  q 1→2   dwell, then particles migrate 2 → 3
 *  q = 2   pattern of section 3, label 3 active
 *
 * Reads its content from the Webflow Designer DOM:
 *   [data-chladni="wrapper"]  tall scroll wrapper (height set by script)
 *   [data-chladni="canvas"]   div the <canvas> is injected into
 *   [data-chladni="label"]    one per section, in order; carries
 *                             data-m / data-n / data-a / data-b
 *   [data-chladni="desc"]     one per section, in order (crossfaded)
 * The active label gets the class "is-active" — style it in Webflow.
 * ───────────────────────────────────────────────────────── */
(function () {
  "use strict";

  /* Particle simulation — values tuned in prototype/index.html */
  var SIM = {
    particles:  16000,   // number of particles on the plate
    drift:      0.0055,  // step toward nodal lines, per frame, ∝ |f|
    baseJitter: 0.0022,  // random walk everywhere (widens the bands)
    ampJitter:  0.004,   // extra jitter ∝ |f| (vibration off the nodes)
    respawn:    0.003,   // fraction of particles re-seeded per frame
    dotSize:    1.4,     // particle square size, CSS px
    dotOpacity: 0.45,    // particle alpha
    dotColor:   "190, 190, 184",  // particle RGB
    trailFade:  0.38,    // erased alpha per frame; lower = longer trails
    canvasFrac: 0.86,    // visual size as fraction of min(vw, vh)
    maskFade:   0.35,    // radial edge fade: 0 = none, 1 = fades from centre
  };

  /* Scroll behaviour */
  var SCROLL = {
    perSection: 1.0,   // viewport-heights of scroll per section
    dwell:      0.28,  // fraction of each segment held steady at each end
    smoothing:  0.10,  // per-frame lerp of q toward its scroll target
    textFade:   0.35,  // |q - i| range over which a description fades out
  };

  var REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function lerp(p, q, t) { return p + (q - p) * t; }
  function smoothstep(t) { return t * t * (3 - 2 * t); }

  /* ── Read sections from the Designer DOM ───────────────── */
  var wrapper = document.querySelector('[data-chladni="wrapper"]');
  var mount = document.querySelector('[data-chladni="canvas"]');
  var labelEls = Array.prototype.slice.call(document.querySelectorAll('[data-chladni="label"]'));
  var descEls = Array.prototype.slice.call(document.querySelectorAll('[data-chladni="desc"]'));
  if (!wrapper || !mount || labelEls.length < 2) return;

  var PATTERNS = labelEls.map(function (el) {
    return {
      m: parseFloat(el.getAttribute("data-m") || "3"),
      n: parseFloat(el.getAttribute("data-n") || "5"),
      a: parseFloat(el.getAttribute("data-a") || "1"),
      b: parseFloat(el.getAttribute("data-b") || "1"),
    };
  });
  var N = PATTERNS.length;

  function sizeWrapper() {
    wrapper.style.height = (1 + (N - 1) * SCROLL.perSection) * 100 + "vh";
  }
  sizeWrapper();

  /* ── Canvas ────────────────────────────────────────────── */
  var canvas = document.createElement("canvas");
  mount.appendChild(canvas);
  var ctx = canvas.getContext("2d");
  var view = { size: 0, dpr: 1 };

  function sizeCanvas() {
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.size = Math.round(Math.min(innerWidth, innerHeight) * SIM.canvasFrac);
    canvas.width = view.size * view.dpr;
    canvas.height = view.size * view.dpr;
    canvas.style.width = view.size + "px";
    canvas.style.height = view.size + "px";
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  }

  /* Radial fade so the plate dissolves into the page background.
   * Smoothstep-eased stops — a plain two-stop gradient has a visible
   * "knee" where the fade begins. */
  function applyMask() {
    if (SIM.maskFade <= 0) {
      canvas.style.webkitMaskImage = "none";
      canvas.style.maskImage = "none";
      return;
    }
    var start = (1 - SIM.maskFade) * 100;
    var stops = [];
    var steps = 8;
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var alpha = 1 - smoothstep(t);
      stops.push("rgba(0,0,0," + alpha.toFixed(3) + ") " + (start + t * (100 - start)).toFixed(1) + "%");
    }
    var mask = "radial-gradient(circle closest-side, " + stops.join(", ") + ")";
    canvas.style.webkitMaskImage = mask;
    canvas.style.maskImage = mask;
  }

  sizeCanvas();
  applyMask();
  addEventListener("resize", function () { sizeCanvas(); sizeWrapper(); });

  /* ── Particles ─────────────────────────────────────────── */
  var px = new Float32Array(SIM.particles);
  var py = new Float32Array(SIM.particles);
  for (var i = 0; i < SIM.particles; i++) {
    px[i] = Math.random();
    py[i] = Math.random();
  }

  /* Chladni field + analytic gradient at (x, y) ∈ [0,1]².
   * Centered cosine form, phase anchored at the plate centre:
   * f(u,v) = a·cos(πnu)·cos(πmv) + b·cos(πmu)·cos(πnv),  u = x−½, v = y−½
   * Interpolating m/n moves nodal lines radially, not from a corner. */
  var field = { f: 0, fx: 0, fy: 0 };
  function evalField(x, y, p) {
    var u = x - 0.5, v = y - 0.5;
    var s1 = Math.sin(Math.PI * p.n * u), c1 = Math.cos(Math.PI * p.n * u);
    var s2 = Math.sin(Math.PI * p.m * v), c2 = Math.cos(Math.PI * p.m * v);
    var s3 = Math.sin(Math.PI * p.m * u), c3 = Math.cos(Math.PI * p.m * u);
    var s4 = Math.sin(Math.PI * p.n * v), c4 = Math.cos(Math.PI * p.n * v);
    field.f  = p.a * c1 * c2 + p.b * c3 * c4;
    field.fx = -Math.PI * (p.a * p.n * s1 * c2 + p.b * p.m * s3 * c4);
    field.fy = -Math.PI * (p.a * p.m * c1 * s2 + p.b * p.n * c3 * s4);
  }

  /* ── Scroll → pattern position q ───────────────────────── */
  var q = 0;

  function scrollTargetQ() {
    var rect = wrapper.getBoundingClientRect();
    var scrollable = wrapper.offsetHeight - innerHeight;
    var p = clamp(scrollable > 0 ? -rect.top / scrollable : 0, 0, 1);
    var raw = p * (N - 1);
    var i = Math.min(Math.floor(raw), N - 2);
    var t = raw - i;
    var t2 = clamp((t - SCROLL.dwell) / (1 - 2 * SCROLL.dwell), 0, 1);
    if (REDUCED) return i + Math.round(t2); // snap, no scrubbed morph
    return i + smoothstep(t2);
  }

  var current = { m: 0, n: 0, a: 0, b: 0 };
  function patternAt(qv) {
    var i = clamp(Math.floor(qv), 0, N - 2);
    var t = clamp(qv - i, 0, 1);
    var A = PATTERNS[i], B = PATTERNS[i + 1];
    current.m = lerp(A.m, B.m, t);
    current.n = lerp(A.n, B.n, t);
    current.a = lerp(A.a, B.a, t);
    current.b = lerp(A.b, B.b, t);
    return current;
  }

  function updateText(qv) {
    var active = Math.round(qv);
    labelEls.forEach(function (el, i) { el.classList.toggle("is-active", i === active); });
    descEls.forEach(function (el, i) {
      el.style.opacity = clamp(1 - Math.abs(qv - i) / SCROLL.textFade, 0, 1);
    });
  }

  /* ── Main loop ─────────────────────────────────────────── */
  var frameCount = 0;
  function frame() {
    var target = scrollTargetQ();
    q = REDUCED ? target : q + (target - q) * SCROLL.smoothing;

    var p = patternAt(q);
    var settle = REDUCED ? 3 : 1; // settle faster when snapping

    for (var i = 0; i < SIM.particles; i++) {
      if (Math.random() < SIM.respawn) {
        px[i] = Math.random();
        py[i] = Math.random();
        continue;
      }
      evalField(px[i], py[i], p);
      var af = Math.abs(field.f);
      var gl = Math.hypot(field.fx, field.fy) + 1e-6;
      var step = SIM.drift * settle * Math.min(af, 1);
      var dir = field.f > 0 ? -1 : 1;
      var x = px[i] + dir * (field.fx / gl) * step;
      var y = py[i] + dir * (field.fy / gl) * step;
      var jit = SIM.baseJitter + SIM.ampJitter * af;
      x += (Math.random() * 2 - 1) * jit;
      y += (Math.random() * 2 - 1) * jit;
      // re-seed escapees instead of clamping (clamping piles them up
      // into a bright frame at the plate edge)
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        px[i] = Math.random();
        py[i] = Math.random();
      } else {
        px[i] = x;
        py[i] = y;
      }
    }

    // erase a fraction of the previous frame instead of painting a
    // background, so the canvas stays transparent over the page.
    // A multiplicative erase below 0.5 can never clear the last alpha bit
    // (8-bit rounding), leaving a permanent ghost haze — so every 4th
    // frame scrubs at >= 0.51, which drains stuck pixels to true zero.
    frameCount++;
    var erase = frameCount % 4 === 0 ? Math.max(SIM.trailFade, 0.51) : SIM.trailFade;
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0, 0, 0, " + erase + ")";
    ctx.fillRect(0, 0, view.size, view.size);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(" + SIM.dotColor + ", " + SIM.dotOpacity + ")";
    var s = SIM.dotSize;
    for (var j = 0; j < SIM.particles; j++) {
      ctx.fillRect(px[j] * view.size, py[j] * view.size, s, s);
    }

    updateText(q);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
