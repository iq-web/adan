# Component references

This site remains plain HTML, CSS, and JavaScript. The entries below document the visual patterns used or retained in the storefront; they are not React dependencies.

## React Bits

The project's current repository license is **MIT + Commons Clause** (`LICENSE.md`), not plain MIT. The Commons Clause permits use as part of a website or product, but restricts selling, sublicensing, or redistributing the components themselves. No React Bits source code was copied into this site; the effects are original vanilla implementations or pre-existing site code.

| Reference component | Official source | Site use | License / implementation |
| --- | --- | --- | --- |
| Aurora | [reactbits.dev/backgrounds/aurora](https://reactbits.dev/backgrounds/aurora) | Hero ambient light | MIT + Commons Clause for source; original, low-particle Canvas 2D adaptation |
| Shiny Text | [reactbits.dev/text-animations/shiny-text](https://reactbits.dev/text-animations/shiny-text) | Arabic hero headline | MIT + Commons Clause for source; existing CSS gradient sheen, no source copied |
| Count Up | [reactbits.dev/text-animations/count-up](https://reactbits.dev/text-animations/count-up) | Hero statistics and price totals | MIT + Commons Clause for source; existing vanilla counters |
| Pill Nav | [reactbits.dev/components/pill-nav](https://reactbits.dev/components/pill-nav) | Header navigation | MIT + Commons Clause for source; existing vanilla sliding indicator |
| Magic Bento | [reactbits.dev/components/magic-bento](https://reactbits.dev/components/magic-bento) | Category-card layout and pointer lighting | MIT + Commons Clause for source; original CSS and existing pointer handling |
| Spotlight Card | [reactbits.dev/components/spotlight-card](https://reactbits.dev/components/spotlight-card) | Category, product, and benefit-card highlights | MIT + Commons Clause for source; original CSS and existing pointer handling |
| Tilted Card | [reactbits.dev/components/tilted-card](https://reactbits.dev/components/tilted-card) | Product and offer cards | MIT + Commons Clause for source; existing vanilla pointer tilt, also wired to offer cards |
| Specular Button | [reactbits.dev/components/specular-button](https://reactbits.dev/components/specular-button) | CTA and action-button sheen | MIT + Commons Clause for source; existing CSS-only treatment |
| Glow Cursor | [reactbits.dev/animations/glow-cursor](https://reactbits.dev/animations/glow-cursor) | Hero pointer light | MIT + Commons Clause for source; existing pointer-following spotlight, no custom cursor dependency |
| Scroll Reveal | [reactbits.dev/text-animations/scroll-reveal](https://reactbits.dev/text-animations/scroll-reveal) | Section/card entrances | MIT + Commons Clause for source; existing `IntersectionObserver` reveal |

## OriginKit

The following pages informed the lightweight background and whole-word motion choices. No OriginKit code, assets, or component exports were copied. Its licensing page is [docs/licensing](https://www.originkit.dev/docs/licensing); the terms could not be independently confirmed from the publicly rendered page during this change, so this project treats OriginKit as inspiration only.

| Reference | Official source | Site use | License / implementation |
| --- | --- | --- | --- |
| Reactive Lines | [originkit.dev/components/reactive-lines](https://www.originkit.dev/components/reactive-lines) | Cursor-responsive hero atmosphere | License not verified; original Canvas 2D implementation only |
| Spring Text | [originkit.dev/components/spring-text](https://www.originkit.dev/components/spring-text) | Motion reference for whole Arabic words | License not verified; no component code used |
| Scroll Wave Field | [originkit.dev/components/scroll-wave-field](https://www.originkit.dev/components/scroll-wave-field) | Reference for restrained depth and motion | License not verified; no component code used |

## Runtime and accessibility notes

- No framework, build step, or animation CDN was added.
- The hero uses one transparent Canvas 2D layer, capped at device-pixel-ratio 2. An `IntersectionObserver` pauses rendering outside the hero; reduced-motion disables it.
- The canvas uses a small, fixed particle set (9 on narrow screens, 20 otherwise), and the existing CSS hero remains the no-canvas fallback.
- Arabic copy remains intact; no text is split into characters.
- Cursor-following input is restricted to fine pointers. Product/category controls remain usable without hover.
