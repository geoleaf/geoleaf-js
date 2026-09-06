/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Icons for the desktop tab strip's three built-in tabs.
 *
 * 🛑 **WHY THE STRIP STOPPED SPELLING ITS TABS OUT.** They were vertical text
 * (`writing-mode: vertical-rl`, `white-space: nowrap`), so each tab's height was the length
 * of its word — "PARTAGER MA POSITION" alone ran to about a fifth of a laptop screen. Six
 * tabs plus the bottom icon stack overflowed the viewport, and `.gl-rp-tabs` was centred:
 * an overflow in a centred flex column is split EVENLY between the two ends, so the strip
 * lost its first tab at the top and its last icon at the bottom, with `body { overflow:
 * hidden }` cutting both without a scrollbar. Icons remove the cause rather than paper over
 * it — the strip now measures a fixed 28 px per tab whatever the language.
 *
 * ⚠️ **The word survives as the ACCESSIBLE NAME**, not as decoration: the text WAS the
 * button's name, so `makeTabButton` posts it as `aria-label` and `title`. Dropping it would
 * leave six anonymous buttons, which the axe scan in the E2E suite says out loud.
 *
 * ⚠️ Markup strings rather than built nodes, and that is deliberate: they take the same
 * `DOMSecurity.setSafeHTML` route as the icons plugins provide, so there is ONE sanitising
 * path for the strip rather than one for the core's own icons and another for everyone else.
 *
 * Format matches the plugins' (`routing`, `table`, `position-share`): a 24×24 `viewBox`,
 * `stroke="currentColor"`, no fill, sized to 18 px by the stylesheet.
 */

/** Opening of an SVG shared by the three icons — same attributes as the plugins'. */
const _OPEN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"' +
    ' stroke-linecap="round" stroke-linejoin="round">';

/** Funnel — filters. */
export const ICON_FILTERS = `${_OPEN}<path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>`;

/** Stacked sheets — the layer manager. */
export const ICON_LAYERS =
    `${_OPEN}<path d="M12 3 3 8l9 5 9-5-9-5z"/><path d="M3 12l9 5 9-5"/>` +
    `<path d="M3 16l9 5 9-5"/></svg>`;

/** Keyed list — the legend. */
export const ICON_LEGEND =
    `${_OPEN}<circle cx="5" cy="7" r="2"/><path d="M10 7h10"/>` +
    `<circle cx="5" cy="12" r="2"/><path d="M10 12h10"/>` +
    `<circle cx="5" cy="17" r="2"/><path d="M10 17h10"/></svg>`;
