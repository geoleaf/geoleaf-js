---
title: "Breakpoints — GeoLeaf Mobile Friendly"
---

# Breakpoints — GeoLeaf Mobile Friendly

---

## CSS variables

Defined in `src/css/geoleaf-theme.css` (`:root`):

| Variable     | Value  | Usage                                                  |
| ------------ | ------ | ------------------------------------------------------ |
| `--gl-bp-sm` | 480px  | Smartphone                                             |
| `--gl-bp-md` | 640px  | Large phablet / transition                             |
| `--gl-bp-lg` | 768px  | 6″ tablet — **icons-only pill bar threshold** (mobile) |
| `--gl-bp-xl` | 1024px | 10″ / 13″ desktop                                      |

---

## "Mobile" threshold for the pill bar

- **Choice: 768px** (`--gl-bp-lg`).
- At `max-width: 768px`: the utility pill bar is shown (icons only), panels become overlays/sheets.
- Above 768px: desktop layout (theme bar, side panels, and so on).

---

## Usage in code

- **CSS**: media queries use pixel values directly (CSS variables are not allowed in `@media`). Keep them consistent with the table above, for example:
    - `@media (max-width: 768px)` for the mobile threshold / pill bar.
    - `@media (max-width: 640px)` for phablet.
    - `@media (max-width: 480px)` for small smartphones.
    - `@media (min-width: 1024px)` for large desktop.
- **JavaScript**: use `getComputedStyle(document.documentElement).getPropertyValue('--gl-bp-lg')` (or an equivalent) when viewport detection has to match the breakpoints.

---

## Viewport

Application pages (for example `demo/index.html`) must include:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

## Do not use `user-scalable=no` (it blocks zooming, which harms accessibility).

## Behaviour by device

| Width       | Device                 | Behaviour                                                                                   |
| ----------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| ≤ 768 px    | Smartphone / 6" tablet | Pill bar, overlay sheets, POI side panel at **100vw** as an overlay (the map is not pushed) |
| 769–1024 px | 10" desktop            | Desktop layout, `--gl-sidepanel-width: 360px`, map offset by 360 px                         |
| ≥ 1025 px   | 13"+ desktop           | Desktop layout, `--gl-sidepanel-width: 420px` (default), map offset by 420 px               |

### The `--gl-sidepanel-width` variable

The width of the POI side panel is driven by the `--gl-sidepanel-width` CSS variable:

- Set to `420px` in the `:root` of every theme file (`geoleaf-theme.css`, `geoleaf-theme-alt.css`, `geoleaf-theme-green.css`).
- Overridden to `360px` inside `@media (min-width: 769px) and (max-width: 1024px)` in those same files.
- On mobile (≤ 768px) the panel's `width: 100vw` overrides the variable; the map keeps `right: 0`.

Every dependent offset (`.maplibregl-ctrl-bottom-right`, `.gl-theme-toggle--map`, `.maplibregl-ctrl-top-right`) uses `calc(var(--gl-sidepanel-width) + 10px)` — no hard-coded `420px` value remains.

---

## Pill bar — accessibility summary

- Every button carries an `aria-label`.
- Buttons that open a sheet carry `aria-expanded="false"` by default and switch to `"true"` on opening.
- The sheet dialog uses `role="dialog"`, `aria-modal="true"`, `aria-labelledby="gl-sheet-panel-title"`.
- Tab/Shift-Tab focus trap inside the sheet; Escape closes it; focus returns to the trigger on close.
- Minimum touch target of 44 px; `:focus-visible` styled with `--gl-color-focus-ring`.
