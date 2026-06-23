import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function createElement(name, attrs = {}) {
  return {
    name,
    attrs,
    style: {},
    children: [],
    parentElement: null,
    offsetHeight: 3000,
    classList: {
      toggle() {},
    },
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
    },
    getAttribute(key) {
      return this.attrs[key] || null;
    },
    getBoundingClientRect() {
      return { width: 1126, height: 1000, top: 0, left: 0 };
    },
  };
}

function createHarness(options = {}) {
  let resolveFonts;
  const fontReady = new Promise((resolve) => {
    resolveFonts = resolve;
  });
  const listeners = {};
  const rafQueue = [];
  const wrapper = createElement("wrapper", { "data-chladni": "wrapper" });
  const hero = createElement("hero");
  const mount = createElement("mount", { "data-chladni": "canvas" });
  mount.parentElement = hero;
  hero.children.push(mount);
  const labels = [
    createElement("label", { "data-m": "3", "data-n": "5", "data-a": "1", "data-b": "1" }),
    createElement("label", { "data-m": "6", "data-n": "8", "data-a": "1", "data-b": "1" }),
  ];
  const descs = [createElement("desc"), createElement("desc")];

  const context = {
    window: null,
    document: {
      readyState: "loading",
      fonts: { ready: fontReady },
      querySelector(selector) {
        if (selector === '[data-chladni="wrapper"]') return wrapper;
        if (selector === '[data-chladni="canvas"]') return mount;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '[data-chladni="label"]') return labels;
        if (selector === '[data-chladni="desc"]') return descs;
        return [];
      },
      createElement(tag) {
        const el = createElement(tag);
        if (tag === "canvas") {
          el.getContext = () => ({
            setTransform() {},
            fillRect() {},
            globalCompositeOperation: "",
            fillStyle: "",
          });
        }
        return el;
      },
    },
    innerWidth: 1126,
    innerHeight: 1135,
    devicePixelRatio: 2,
    matchMedia: () => ({ matches: false }),
    addEventListener(type, handler) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    removeEventListener(type, handler) {
      listeners[type] = (listeners[type] || []).filter((entry) => entry !== handler);
    },
    requestAnimationFrame(handler) {
      rafQueue.push(handler);
      return rafQueue.length;
    },
    performance: { now: () => 0 },
    Date,
    Math,
    Float32Array,
    Array,
    Promise,
    setTimeout,
  };
  Object.assign(context, options.globals || {});
  context.window = context;

  return {
    context: vm.createContext(context),
    listeners,
    rafQueue,
    mount,
    wrapper,
    resolveFonts,
    fire(type) {
      for (const handler of listeners[type] || []) handler();
    },
    flushRaf(count = 1) {
      for (let i = 0; i < count; i++) {
        const handler = rafQueue.shift();
        if (!handler) return;
        handler();
      }
    },
  };
}

const source = fs.readFileSync(new URL("./embed.js", import.meta.url), "utf8");

async function drainMicrotasks(count = 5) {
  for (let i = 0; i < count; i++) await Promise.resolve();
}

const harness = createHarness();
vm.runInContext(source, harness.context);

assert.equal(
  harness.mount.children.length,
  0,
  "the canvas must not be injected before the stable load/layout boot finishes",
);
assert.equal(
  harness.rafQueue.length,
  0,
  "the particle animation loop must not start before the stable boot finishes",
);

harness.fire("load");
harness.resolveFonts();
await drainMicrotasks();
harness.flushRaf(2);
await drainMicrotasks();

assert.equal(harness.mount.children.length, 1, "the canvas is injected after stable boot");
assert.equal(harness.mount.children[0].style.width, "860px", "canvas display width uses stable layout bounds");
assert.ok(harness.rafQueue.length > 0, "the animation loop starts after stable boot");
assert.equal(harness.wrapper.style.height, "200vh", "native mode creates the expected scroll distance");
assert.equal(harness.mount.parentElement.style.position, "sticky", "native mode pins the hero with sticky positioning");
assert.equal(harness.mount.parentElement.style.top, "0px", "native mode anchors the hero to the top of the viewport");
assert.equal(harness.mount.parentElement.style.bottom, "auto", "native mode clears bottom anchoring that can trap the hero low");

const smootherScrolls = [];
let scrollTriggerConfig;
const gsapHarness = createHarness({
  globals: {
    scrollY: 512,
    pageYOffset: 512,
    gsap: { registerPlugin() {} },
    ScrollTrigger: {
      create(config) {
        scrollTriggerConfig = config;
        return { refresh() {} };
      },
      refresh() {},
    },
    ScrollSmoother: {
      get() {
        return {
          refresh() {},
          scrollTo(value, smooth) {
            smootherScrolls.push({ value, smooth });
          },
        };
      },
    },
  },
});
vm.runInContext(source, gsapHarness.context);
gsapHarness.fire("load");
gsapHarness.resolveFonts();
await drainMicrotasks();
gsapHarness.flushRaf(2);
await drainMicrotasks();

assert.equal(scrollTriggerConfig.pinSpacing, false, "GSAP mode keeps wrapper height stable instead of adding pin spacing");
gsapHarness.fire("scroll");
assert.deepEqual(
  smootherScrolls,
  [{ value: 512, smooth: false }],
  "first scroll snaps ScrollSmoother to the native scroll position before refreshing pins",
);
