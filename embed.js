/* ─────────────────────────────────────────────────────────
 * SUITED — scroll-scrubbed Chladni morph (Webflow embed)
 *
 * v9 — stable first-load sizing for Webflow + GSAP ScrollSmoother sites.
 *   • If GSAP + ScrollTrigger are present, the hero is pinned and the
 *     morph is driven by a ScrollTrigger (the only reliable way inside
 *     ScrollSmoother, which transforms the page and breaks CSS sticky).
 *   • Otherwise it falls back to native position:sticky + a tall wrapper.
 *   • Initial DOM writes wait until load, fonts, and two animation frames have
 *     settled so Webflow can finish layout before viewport measurements run.
 *
 * Reads from the Webflow DOM:
 *   [data-chladni="wrapper"]  the section (its direct child is the pinned hero)
 *   [data-chladni="canvas"]   div the <canvas> is injected into
 *   [data-chladni="label"]    one per section, carries data-m/n/a/b
 *   [data-chladni="desc"]     one per section (crossfaded)
 * The active label gets the class "is-active".
 * ───────────────────────────────────────────────────────── */
(function () {
  "use strict";

  /* Particle simulation — values tuned in prototype/index.html */
  var SIM = {
    particles:  16000,
    drift:      0.0055,
    baseJitter: 0.0022,
    ampJitter:  0.004,
    respawn:    0.003,
    dotSize:    1.4,
    dotOpacity: 0.45,
    dotColor:   "190, 190, 184",
    trailFade:  0.38,
    canvasFrac: 0.86,
    maskFade:   0.35,
    maxRes:     720,   // cap the canvas backing resolution (px) — bounds per-frame cost
    minParticles: 6000, // floor for the adaptive quality throttle
  };

  /* Scroll behaviour */
  var SCROLL = {
    perSection: 1.0,   // viewport-heights of scroll per section transition
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
  var hero = (mount.closest && mount.closest(".signal-hero")) || mount.parentElement || wrapper; // the element to pin
  var previousVisibility = wrapper.style.visibility;
  wrapper.style.visibility = "hidden";

  var PATTERNS = labelEls.map(function (el) {
    return {
      m: parseFloat(el.getAttribute("data-m") || "3"),
      n: parseFloat(el.getAttribute("data-n") || "5"),
      a: parseFloat(el.getAttribute("data-a") || "1"),
      b: parseFloat(el.getAttribute("data-b") || "1"),
    };
  });
  var N = PATTERNS.length;

  /* ── Canvas ────────────────────────────────────────────── */
  var canvas = null;
  var ctx = null;
  var view = { size: 0, dpr: 1 };

  function positiveRect(el) {
    if (!el || !el.getBoundingClientRect) return null;
    var rect = el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return rect;
  }

  function viewportSize() {
    var vv = window.visualViewport;
    var doc = document.documentElement || {};
    return {
      width: Math.max(1, Math.round((vv && vv.width) || window.innerWidth || doc.clientWidth || 1)),
      height: Math.max(1, Math.round((vv && vv.height) || window.innerHeight || doc.clientHeight || 1)),
    };
  }

  function layoutBounds() {
    var vp = viewportSize();
    var heroRect = positiveRect(hero);
    var mountRect = positiveRect(mount);
    var width = (heroRect && heroRect.width) || (mountRect && mountRect.width) || vp.width;
    var height = (heroRect && heroRect.height) || (mountRect && mountRect.height) || vp.height;
    return {
      width: Math.max(1, Math.min(width, vp.width)),
      height: Math.max(1, Math.min(height, vp.height)),
    };
  }

  function sizeCanvas() {
    // Displayed size follows the viewport; the internal (backing) resolution is
    // capped at SIM.maxRes. The dominant per-frame cost is clearing + filling
    // this many pixels, so capping keeps the work bounded and consistent across
    // screens. A soft particle field upscales cleanly, so this is near-invisible.
    var bounds = layoutBounds();
    var display = Math.round(Math.min(bounds.width, bounds.height) * SIM.canvasFrac);
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    view.size = Math.min(Math.round(display * dpr), SIM.maxRes);
    canvas.width = view.size;
    canvas.height = view.size;
    canvas.style.width = display + "px";
    canvas.style.height = display + "px";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* Smoothstep-eased radial fade so the plate dissolves into the page. */
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

  /* ── Particles ─────────────────────────────────────────── */
  var px = null;
  var py = null;
  function seedParticles() {
    px = new Float32Array(SIM.particles);
    py = new Float32Array(SIM.particles);
    for (var i = 0; i < SIM.particles; i++) {
      px[i] = Math.random();
      py[i] = Math.random();
    }
  }

  /* Chladni field + analytic gradient, centered cosine form. */
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

  /* ── Scroll engine ─────────────────────────────────────── *
   * `progress` is 0→1 across the whole pinned section. It is filled
   * either by a ScrollTrigger (GSAP sites) or computed from the
   * wrapper's position (native sites). */
  var progress = 0;
  var engineMode = "";
  var scrollTriggerInstance = null;

  function sizeWrapper() {
    wrapper.style.height = (1 + (N - 1) * SCROLL.perSection) * 100 + "vh";
  }

  function setupNative() {
    engineMode = "native";
    hero.style.position = "sticky";
    hero.style.top = "0px";
    hero.style.bottom = "auto";
    sizeWrapper();
  }

  function setupGsap(gsap, ST) {
    engineMode = "gsap";
    gsap.registerPlugin(ST);
    hero.style.position = "relative"; // ScrollTrigger does the pinning, not CSS sticky
    wrapper.style.height = "";          // pin spacing creates the scroll distance
    scrollTriggerInstance = ST.create({
      trigger: wrapper,
      start: "top top",
      end: function () { return "+=" + (viewportSize().height * (N - 1) * SCROLL.perSection); },
      pin: hero,
      pinSpacing: true,
      pinType: "transform", // required inside ScrollSmoother (transformed scroller)
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onUpdate: function (self) { progress = self.progress; },
    });
    ST.refresh();
  }

  // Default to plain CSS sticky. Only switch to ScrollTrigger pinning if a
  // ScrollSmoother instance is ACTUALLY running — its transform is what breaks
  // sticky. (Merely loading the GSAP libraries is not enough; the previous
  // version wrongly pinned whenever gsap was present.) Decide at `load`, after
  // the host's DOMContentLoaded code has had a chance to create the smoother.
  function startEngine() {
    var smoother = window.ScrollSmoother && window.ScrollSmoother.get && window.ScrollSmoother.get();
    if (smoother && window.gsap && window.ScrollTrigger) {
      setupGsap(window.gsap, window.ScrollTrigger);
    } else {
      setupNative();
    }
  }

  function currentProgress() {
    if (engineMode === "gsap") return progress;
    var rect = wrapper.getBoundingClientRect();
    var scrollable = wrapper.offsetHeight - viewportSize().height;
    return clamp(scrollable > 0 ? -rect.top / scrollable : 0, 0, 1);
  }

  function scrollTargetQ() {
    var p = currentProgress();
    var raw = p * (N - 1);
    var i = Math.min(Math.floor(raw), N - 2);
    var t = raw - i;
    var t2 = clamp((t - SCROLL.dwell) / (1 - 2 * SCROLL.dwell), 0, 1);
    if (REDUCED) return i + Math.round(t2);
    return i + smoothstep(t2);
  }

  var q = 0;
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

  /* ── Pause the simulation when the section is off-screen ──
   * The heavy per-frame work (16k particles + full-canvas clear) only runs
   * while the section is near the viewport. This keeps it from competing
   * with the rest of the page during initial load (the usual cause of an
   * intermittently janky start) and saves CPU when it isn't being viewed. */
  var visible = true;
  function observeVisibility() {
    if ("IntersectionObserver" in window) {
      visible = false;
      new IntersectionObserver(function (entries) {
        visible = entries[entries.length - 1].isIntersecting;
      }, { rootMargin: "300px 0px" }).observe(wrapper);
    }
  }

  /* ── Main loop ─────────────────────────────────────────── */
  var frameCount = 0;
  var active = SIM.particles;       // particles actually simulated/drawn
  var now = (window.performance || Date);
  var fpsLast = now.now(), fpsAccum = 0, fpsSamples = 0;

  function frame() {
    if (!visible) { fpsLast = now.now(); requestAnimationFrame(frame); return; }

    // Adaptive quality: if sustained frame time is high (contended/slow load),
    // shed particles so it self-heals to a smooth rate instead of staying janky
    // until a manual reload. Pauses (dt > 100ms) are ignored.
    var t = now.now(), dt = t - fpsLast; fpsLast = t;
    if (dt > 0 && dt < 100) { fpsAccum += dt; fpsSamples++; }
    if (fpsSamples >= 50) {
      var avg = fpsAccum / fpsSamples; fpsAccum = 0; fpsSamples = 0;
      if (avg > 26 && active > SIM.minParticles) {
        active = Math.max(SIM.minParticles, Math.floor(active * 0.8));
      }
    }

    var target = scrollTargetQ();
    q = REDUCED ? target : q + (target - q) * SCROLL.smoothing;

    var p = patternAt(q);
    var settle = REDUCED ? 3 : 1;

    for (var i = 0; i < active; i++) {
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
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        px[i] = Math.random();
        py[i] = Math.random();
      } else {
        px[i] = x;
        py[i] = y;
      }
    }

    frameCount++;
    var erase = frameCount % 4 === 0 ? Math.max(SIM.trailFade, 0.51) : SIM.trailFade;
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0, 0, 0, " + erase + ")";
    ctx.fillRect(0, 0, view.size, view.size);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(" + SIM.dotColor + ", " + SIM.dotOpacity + ")";
    var s = SIM.dotSize;
    for (var j = 0; j < active; j++) {
      ctx.fillRect(px[j] * view.size, py[j] * view.size, s, s);
    }

    updateText(q);
    requestAnimationFrame(frame);
  }

  /* ── Stable Webflow boot ───────────────────────────────── */
  var booted = false;
  var refreshQueued = false;

  function waitForLoad() {
    if (document.readyState === "complete") return Promise.resolve();
    return new Promise(function (resolve) {
      addEventListener("load", resolve, { once: true });
    });
  }

  function waitForFonts() {
    if (!document.fonts || !document.fonts.ready) return Promise.resolve();
    return document.fonts.ready.catch(function () {});
  }

  function afterFrames(count) {
    return new Promise(function (resolve) {
      function tick() {
        count--;
        if (count <= 0) resolve();
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  function refreshLayout() {
    sizeCanvas();
    if (engineMode === "native") {
      hero.style.height = viewportSize().height + "px";
      sizeWrapper();
    }
    if (engineMode === "gsap" && window.ScrollTrigger) {
      if (scrollTriggerInstance && scrollTriggerInstance.refresh) scrollTriggerInstance.refresh();
      else window.ScrollTrigger.refresh();
    }
  }

  function scheduleLayoutRefresh() {
    if (!booted || refreshQueued) return;
    refreshQueued = true;
    afterFrames(2).then(function () {
      refreshQueued = false;
      refreshLayout();
    });
  }

  function addLayoutListeners() {
    addEventListener("resize", scheduleLayoutRefresh);
    addEventListener("orientationchange", scheduleLayoutRefresh);
    if (window.visualViewport && window.visualViewport.addEventListener) {
      window.visualViewport.addEventListener("resize", scheduleLayoutRefresh);
    }
  }

  function boot() {
    if (booted) return;
    booted = true;
    canvas = document.createElement("canvas");
    mount.appendChild(canvas);
    ctx = canvas.getContext("2d");
    seedParticles();
    sizeCanvas();
    applyMask();
    hero.style.height = viewportSize().height + "px";
    startEngine();
    observeVisibility();
    addLayoutListeners();
    q = scrollTargetQ();
    updateText(q);
    wrapper.style.visibility = previousVisibility;
    requestAnimationFrame(frame);
  }

  waitForLoad()
    .then(waitForFonts)
    .then(function () { return afterFrames(2); })
    .then(boot)
    .catch(function (error) {
      wrapper.style.visibility = previousVisibility;
      if (window.console && window.console.error) window.console.error(error);
    });
})();
