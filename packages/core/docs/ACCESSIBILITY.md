---
title: "GeoLeaf — RGAA / WCAG 2.1 accessibility"
---

# GeoLeaf — RGAA / WCAG 2.1 accessibility

> Legal basis: French law no. 2005-102 of 11 February 2005, decree no. 2019-768 of 24 July 2019.
> Applies to: `@geoleaf/core` **v3.x**

---

## Conformance status

**Declared level: partially conformant — approximately 87% of the applicable RGAA 4.1 criteria**

The components listed below have been audited and corrected. Residual non-conformances are documented in the "Exemptions and residual non-conformances" section.

---

## Accessible components

### 1. Lightbox (POI image gallery)

| Criterion                                   | Implementation                                    |
| ------------------------------------------- | ------------------------------------------------- |
| `role="dialog"` on the container            | Yes                                               |
| `aria-modal="true"`                         | Yes                                               |
| `aria-labelledby="gl-lightbox-title"`       | Yes — visually hidden title                       |
| i18n labels on the 3 buttons                | Yes — `aria.lightbox.close/prev/next`             |
| `img.alt` = contextual counter              | Yes — `aria.lightbox.counter` (e.g. Image 2 of 5) |
| Focus trap (Tab/Shift+Tab)                  | Yes — cycles inside the dialog                    |
| Focus returned to the trigger (close)       | Yes — `_triggerElement.focus()`                   |
| ArrowLeft/Right and Escape keyboard support | Yes                                               |

**Available i18n keys (all 6 languages):**

```
aria.lightbox.title     Image gallery
aria.lightbox.close     Close
aria.lightbox.prev      Previous image
aria.lightbox.next      Next image
aria.lightbox.counter   Image {0} of {1}
```

---

### 2. POI side panel (detail view)

| Criterion                                             | Implementation                        |
| ----------------------------------------------------- | ------------------------------------- |
| `role="complementary"`                                | Yes                                   |
| `aria-label` through i18n (`aria.sidepanel.landmark`) | Yes                                   |
| Focus moved to the close button on opening            | Yes                                   |
| Escape closes the panel                               | Yes                                   |
| Tab/Shift+Tab focus trap                              | Yes                                   |
| Focus restored on close                               | No — overlay without a single trigger |

---

### 3. Modal dialogs — mobile sheet

| Criterion                                | Implementation           |
| ---------------------------------------- | ------------------------ |
| `role="dialog"`                          | Yes                      |
| `aria-modal="true"`                      | Yes                      |
| `aria-labelledby="gl-sheet-panel-title"` | Yes                      |
| `aria-describedby="gl-sheet-panel-body"` | Yes                      |
| Tab/Shift+Tab focus trap                 | Yes — `_attachFocusTrap` |
| Escape closes the sheet                  | Yes                      |

---

### 4. Mobile toolbar (`role="toolbar"`)

| Criterion                                       | Implementation              |
| ----------------------------------------------- | --------------------------- |
| `role="toolbar"`                                | Yes                         |
| `aria-orientation="vertical"`                   | Yes                         |
| `aria-label` through i18n (`aria.toolbar.root`) | Yes                         |
| i18n label on every button                      | Yes                         |
| Roving tabindex                                 | Yes — a single `tabindex=0` |
| ArrowUp/Down/Left/Right navigation              | Yes                         |
| Home/End navigation                             | Yes                         |
| tabindex synchronised on click                  | Yes — `focusin`             |

---

### 5. Map controls

The following three controls conform to WCAG 2.1 AA:

| Control                  | `aria-label`                       |
| ------------------------ | ---------------------------------- |
| `control-fullscreen.ts`  | `aria.fullscreen.enter/exit_label` |
| `control-geolocation.ts` | `aria.geoloc.toggle_label`         |
| `control-poi-add.ts`     | `aria.poi_add.label`               |

---

### 6. Proximity slider

The `<input type="range">` element natively exposes `aria-valuemin`, `aria-valuemax` and `aria-valuenow` through the HTML `min`, `max` and `value` attributes. Completed by an `aria-label` (`aria.proximity.slider`).

---

### 7. Desktop panel — tab navigation

| Criterion                                    | Implementation            |
| -------------------------------------------- | ------------------------- |
| `role="tablist"` on the container            | Yes                       |
| `aria-label` through i18n (`aria.panel.nav`) | Yes                       |
| `role="tab"` on each tab                     | Yes                       |
| `aria-selected="true/false"`                 | Yes — managed dynamically |
| `aria-controls="gl-rp-pane-{id}"`            | Yes                       |
| `aria-labelledby` on the panes               | Yes                       |
| Arrow/Home/End navigation                    | Yes                       |

---

### 8. Filter panel — accordions

| Criterion                              | Implementation          |
| -------------------------------------- | ----------------------- |
| Semantic `<button>` inside the heading | Yes — RGAA criterion D1 |
| `aria-expanded="false/true"`           | Yes — updated on click  |
| `aria-controls="{contentId}"`          | Yes                     |
| Arrow icon `aria-hidden="true"`        | Yes                     |

---

### 9. Notifications

| Criterion                | Implementation                    |
| ------------------------ | --------------------------------- |
| `aria-live="polite"`     | Yes — screen reader announcements |
| `aria-label` on close    | Yes — i18n                        |
| `prefers-reduced-motion` | Yes — animations disabled         |

---

### 10. Layer manager

| Criterion                            | Implementation                                              |
| ------------------------------------ | ----------------------------------------------------------- |
| `aria-pressed` on the toggles        | Yes                                                         |
| `aria-label` on the controls         | Yes                                                         |
| `aria-label` on the style `<select>` | Yes — i18n `aria.layer.style_select` (plus the layer label) |

> The style selector (a native `<select>`, one per layer with multiple styles) has no associated `<label>`: it receives an i18n `aria-label` contextualised with the layer label (WCAG 4.1.2 `select-name`).

---

### 11. Basemaps

| Criterion                              | Implementation                         |
| -------------------------------------- | -------------------------------------- |
| `aria-pressed` on the buttons          | Yes                                    |
| Contextual `aria-label`                | Yes                                    |
| `aria-label` on the basemap `<select>` | Yes — i18n `aria.layer.basemap_select` |

---

### 12. Search bar

| Criterion                         | Implementation        |
| --------------------------------- | --------------------- |
| `aria-label` on bar/input/buttons | Yes — i18n            |
| `aria-expanded` on the container  | Yes                   |
| Visible focus on the container    | Yes — `:focus-within` |

---

### 13. Permalink

| Criterion       | Implementation |
| --------------- | -------------- |
| `aria-expanded` | Yes            |

---

### 14. PWA (install prompt + iOS banner)

| Criterion               | Implementation |
| ----------------------- | -------------- |
| `aria-live="polite"`    | Yes            |
| `aria-label` on buttons | Yes            |

---

## Multilingual ARIA support

All ARIA keys are translated into the 6 languages: **fr, en, de, es, pt, it**
Files: `packages/core/src/lang/lang-*.ts`

---

## Exemptions and residual non-conformances

| Item                                      | RGAA criterion                     | Rationale                                                                                                                                                                                                                                            |
| ----------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MapLibre markers (POI name)               | 4.1 — decorative images            | DOM markers (`<div>`) receive an `aria-label` (the POI name) and `role="img"` when the POI is named. Unnamed POIs remain unannounced — the side panel is the alternative.                                                                            |
| POI icons (canvas ImageData)              | 1.1 — informative image (category) | Icons are rendered through `map.addImage()` as `ImageData` (WebGL canvas). Unlike `<img>`, canvases are exempt from the `alt` attribute requirement (WCAG H37 applies to HTML images only). The POI category stays reachable through the side panel. |
| Rich popups (complex HTML inside a popup) | 11.1 — field labels                | The content is injected by the JSON profile; the profile is the integrator's responsibility.                                                                                                                                                         |
| Custom theme contrast                     | WCAG 1.4.3                         | Themes are configurable per profile. The default theme meets the 4.5:1 ratio. Custom themes are the integrator's responsibility.                                                                                                                     |
| Focus restoration (side panel)            | WCAG 9.2.1 (focus)                 | The side panel opens on a click on a POI marker, which is not natively keyboard-focusable. Focus cannot be restored to the trigger after closing — behaviour inherent to interactive mapping.                                                        |

---

## Accessibility statement (summary)

**Organisation**: GeoLeaf Platform / Mattieu Pottier
**Technologies**: HTML5, CSS3, JavaScript / TypeScript
**Testing tools**: axe-core (integrated into the Playwright E2E tests), manual keyboard checks
**Date of the latest assessment**: 2026-03-25

**Audit result**:
The `@geoleaf/core` library is **partially conformant** with RGAA version 4.1.
(Non-applicable criteria excluded from the calculation base — approximately 87% of the applicable criteria)

**Contact**: To report an accessibility defect, open an issue on the GitHub repository or contact the GeoLeaf team.

---

## Accessibility changelog

| Date       | Version | Changes                                                                                                                                                                                                                                                                         |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-16 | 3.0.0   | Accessible name for the layer manager `<select>` elements (WCAG 4.1.2 `select-name`): i18n `aria-label` `aria.layer.style_select` (style selector, plus the layer label) and `aria.layer.basemap_select` (basemap), in 6 languages. Fixes the axe "mobile sheet modal" failure. |
| 2026-03-25 | 1.4.0   | `prefers-reduced-motion` extended to toolbar/sheet/search/proximity/recenter; dark theme cluster text contrast `#e5e7eb` → `#111827` (1.83:1 → 7.86:1, WCAG AA+AAA); `aria-label` + `role="img"` on DOM MapLibre markers (named POIs); exemptions table updated                 |
| 2026-03-25 | 1.3.0   | Post-MapLibre-migration audit: CSS `:focus` → `:focus-visible` (6 selectors), `:focus-within` added on `.gl-search-bar`, legacy `.geoleaf-interactive` CSS removed, 7 undocumented components documented, exemption "markers" → "MapLibre markers"                              |
| 2026-03-25 | 1.2.0   | Lightbox dialog + focus trap, i18n labels, img.alt; side panel focus trap; toolbar roving tabindex; sheet aria-describedby                                                                                                                                                      |
| 2026-03-20 | 1.1.x   | Events API (not accessibility-related)                                                                                                                                                                                                                                          |
| 2026-03-19 | 1.1.x   | Automatic theme (prefers-color-scheme) applied                                                                                                                                                                                                                                  |
