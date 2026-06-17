# Suited — "Signal" scroll animation: Webflow embed handoff

A scroll-scrubbed Chladni particle animation with 3 morphing states ("Firm / Industry /
Individual signal"). It's **one JS file** plus a small DOM structure built in Webflow.
All text stays as **native, editable Webflow elements** — the script only injects a
transparent `<canvas>`, scrubs the morph on scroll, toggles an `is-active` class on the
current label, and crossfades the descriptions.

## Everything you need
- **Embed kit (code + this doc):** https://github.com/h-emiliia/suited-embed
- **Live reference (target behaviour):** https://suited-signal.vercel.app
- **Script (CDN, production-ready):**
  `https://cdn.jsdelivr.net/gh/h-emiliia/suited-embed@v3/embed.js`

## Add the script

In Webflow → **Page Settings → Custom Code → Before `</body>`**:

```html
<script src="https://cdn.jsdelivr.net/gh/h-emiliia/suited-embed@v1/embed.js" defer></script>
```

> Pinned to `@v3` (a git tag) so the URL is stable and cache-safe. Changes ship by pushing
> a new tag and bumping the number.

## 1. Structure to build in the Designer

```
Section / Div                       data-chladni = wrapper      (DO NOT set a height)
└─ Div  "hero"                      position: sticky; top: 0; height: 100vh; overflow: hidden
   ├─ Div  "canvas mount"           data-chladni = canvas       (absolute, centered)
   ├─ Div  "labels"
   │  ├─ Text "Firm signal"         data-chladni = label  data-m=6.5  data-n=9    data-a=-1.2   data-b=1.7
   │  ├─ Text "Industry signal"     data-chladni = label  data-m=6.1  data-n=4    data-a=-2     data-b=0.45
   │  └─ Text "Individual signal"   data-chladni = label  data-m=4.9  data-n=8.1  data-a=-1.85  data-b=-2
   └─ Div  "descriptions"
      ├─ Text  data-chladni = desc  "What the leading firms are doing — hiring, strategy, and the moves that define the market."
      ├─ Text  data-chladni = desc  "How professionals succeed across law and finance."
      └─ Text  data-chladni = desc  "Your own trajectory — benchmarked, contextualized, and ready to act on."
```

- Custom attributes: **Element Settings → Custom attributes**.
- Labels and descriptions are matched **by order**. Add a label+desc pair to add a section.
- The description copy above is placeholder — swap for final copy any time.

## 2. Required styles

- **wrapper** — `position: relative`; **do not set a height** (the script sets it to
  `100vh + 100vh` per extra section = 300vh here).
- **hero** — `position: sticky; top: 0; height: 100vh; overflow: hidden`.
- **canvas mount** — `position: absolute`, centered. The script creates + sizes the `<canvas>`.
- **descriptions** — stack them: container `position: relative` + fixed/min height, each
  desc `position: absolute`. The script crossfades opacity; it does not lay them out.
- **is-active** — the script adds class `is-active` to the active label; style it (white
  text, show the arrow) with `transition: color .4s` for a soft swap.

## 3. Mobile

On the Mobile breakpoint, stack vertically — **labels centered above**, **descriptions
centered below**:
- labels: `top: 11vh`, full width, `text-align: center`, no transform.
- descriptions: `bottom: 11vh`, full width, centered, `min-height: ~84px` (keep each desc
  `position: absolute` so the crossfade still works).
- optionally shrink the canvas a touch.

These are breakpoint overrides of the desktop positioning — no code needed.
`example.html` in the repo demonstrates the exact rules.

## 4. Notes / gotchas

- **Transparent canvas** — set the section's background (dark) yourself; the plate has a
  soft radial edge fade and blends into any color.
- **Patterns** are read only from `data-m/n/a/b` — retune a section by editing attributes.
- **Particle look / scroll feel / colour** live in the `SIM` / `SCROLL` config at the top
  of `embed.js` (particle colour is `rgba(190,190,184)`). Changing these means editing
  `embed.js` and pushing a new tag.
- **Reduced motion** — with `prefers-reduced-motion: reduce`, the morph snaps between
  states instead of scrubbing.
- **GSAP ScrollSmoother** — if the site uses GSAP (ScrollSmoother/ScrollTrigger), the
  script auto-detects it and pins the hero via **ScrollTrigger** instead of CSS sticky
  (CSS sticky can't work inside ScrollSmoother's transformed scroller). No setup needed —
  just make sure GSAP loads before this script. On non-GSAP sites it uses native sticky.
- The script is inert if the `data-chladni` elements are absent, so it's safe site-wide.
