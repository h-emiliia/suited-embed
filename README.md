# Suited — "Signal" scroll animation (Webflow embed)

A scroll-scrubbed Chladni particle animation with 3 morphing states. One JS file
([embed.js](embed.js)) plus a small DOM structure built in Webflow. All text stays as
native, editable Webflow elements — the script only injects a transparent `<canvas>`,
scrubs the morph on scroll, toggles an `is-active` class on the current label, and
crossfades the descriptions.

- **Live reference:** https://suited-signal.vercel.app
- **Minimal markup (View Source):** [example.html](example.html)

## Add the script

In Webflow → **Page Settings → Custom Code → Before `</body>`**:

```html
<script src="https://cdn.jsdelivr.net/gh/h-emiliia/suited-embed@v1/embed.js" defer></script>
```

> Pinned to `@v1` (a git tag) so the CDN URL is stable and cache-safe. To ship changes,
> push a new tag (`v2`, …) and bump the URL. `@latest` or `@main` also work but can cache
> for up to 24h.

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

## 2. Required styles

- **wrapper** — `position: relative`; **do not set a height** (the script sets it to
  `100vh + 100vh` per extra section).
- **hero** — `position: sticky; top: 0; height: 100vh; overflow: hidden`.
- **canvas mount** — `position: absolute`, centered. Script creates + sizes the `<canvas>`.
- **descriptions** — stack them: container `position: relative` + fixed/min height, each
  desc `position: absolute`. The script crossfades opacity; it does not lay them out.
- **is-active** — script adds class `is-active` to the active label; style it (white text,
  show arrow) with `transition: color .4s`.

## 3. Mobile

On the Mobile breakpoint, stack: labels `top: 11vh` centered, descriptions `bottom: 11vh`
centered (`min-height: ~84px`, keep each desc `position: absolute`). See [example.html](example.html).

## Notes

- **Transparent canvas** — set the section background (dark) yourself; the plate has a soft
  radial edge fade and blends into any color.
- **Patterns** are read from `data-m/n/a/b` — change a section by editing attributes only.
- **Particle look / scroll feel / color** live in the `SIM` / `SCROLL` config at the top of
  `embed.js` (particle colour is `rgba(190,190,184)`). Edit + push a new tag to change.
- **Reduced motion** — morph snaps between states instead of scrubbing.
- The script is inert if the `data-chladni` elements are absent, so it's safe site-wide.
