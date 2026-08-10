/*!
 * @geoleaf/host-runtime — shared runtime library for GeoLeaf plugins
 * © 2026 Mattieu Pottier — MIT License
 *
 * Internal shared library, in two parts:
 *
 *  - **host access** (`host.ts`, `notify-seam.ts`, `log-seam.ts`) — ONE typed accessor and ONE shared
 *    shape for the global `GeoLeaf` namespace assembled at boot by `@geoleaf/core`, so
 *    plugins stop doing `const _g = globalThis as any` with a drifting local shape.
 *  - **shared UI** (`ui/`) — chrome utilities that were forked across plugins:
 *    stylesheet adoption, pointer/touch drag, tooltips (consolidated at PLUGINS S1) and
 *    floating sub-menu anchoring (PLUGINS S5).
 *  - **HTTP wire primitives** (`http.ts`) — domain-neutral fetch/headers/parse helpers
 *    shared by the editor and connector plugins (absorbed from the former
 *    `@geoleaf/http-helpers` package at STRUCT S1).
 *
 * Bundle contract: this package imports NO value from `@geoleaf/core` (that would pull
 * the whole core — boot side-effects, non-tree-shakable — into every plugin bundle).
 * The namespace shape is re-declared here, kept intentionally permissive (a
 * `[key: string]: unknown` tail); precision grows sprint by sprint, mirroring the core's
 * own `GeoLeafGlobal` (`packages/core/src/global.d.ts`). ⚠️ This contract is load-bearing
 * — do not import from `@geoleaf/core` here, not even a type.
 *
 * Declare this package as a **devDependency** (bundled into each consumer, never a
 * runtime dep). Onboarding a plugin takes three steps, not one — the third is easy to
 * miss and breaks the *build*, not the typecheck:
 *
 *   1. `"@geoleaf/host-runtime": "*"` in `devDependencies`
 *   2. `paths` in `tsconfig.json` → `["../../libs/host-runtime/dist/types/index.d.ts"]`
 *   3. `typescript: { compilerOptions: { paths: {} } }` in `rollup.config.mjs` — blanks
 *      the TS alias at build time so rollup resolves to `dist/index.js` by Node resolution
 * https://geoleaf.dev
 */

export {
    getGeoLeaf,
    ensureGeoLeaf,
    coreConfigGet,
    type GeoLeafHost,
    type PluginRegisterOptions,
} from "./host.js";
export { getUINotifications, type UINotificationsSeam } from "./notify-seam.js";
export { Log } from "./log-seam.js";
export { tLabel, getActiveLang } from "./i18n-seam.js";
export {
    getNestedValue,
    createSVGIcon,
    clearElementFast,
    type IconOptions,
} from "./core-utils-seam.js";
export { downloadBlob } from "./download.js";
export { getNativeMap, warnNoCore } from "./map-seam.js";
export { createEl, applyStyleText } from "./dom-seam.js";
export { adoptStylesheet } from "./ui/css-adopt.js";
export { wireDrag } from "./ui/drag.js";
export { wireTouchDrag } from "./ui/touch-drag.js";
export { wireTooltips, showTooltip, hideTooltip } from "./ui/tooltip.js";
export { positionMenuNear, type MenuPositionOptions } from "./ui/menu-position.js";
// ── Décision W3 / A4″ — la plomberie UI appartient à host-runtime (Sprint 6, S6b) ────────
// Arrivées de `field-renderer` le 06/08/2026. W3 se datait « au commit de fusion » ; ce
// commit (`ddc08fae`) a eu lieu sans elle, et elle est sortie du Sprint 5 en B-144.
// ⚠️ Le gain n'est PAS pondéral, et c'est mesuré : `host-runtime` est privé et bundlé chez
// chaque consommateur, exactement comme `field-renderer` l'était — déplacer d'un inliné vers
// un autre inliné ne fait gagner aucun octet. Le gain est d'ARCHITECTURE : `offline-ui` perd
// sa dépendance à `field-renderer`, qui n'est plus inlinée que par `editor`.
export { createFocusTrap, type FocusTrap } from "./ui/focus-trap.js";
export { confirmDialog, type ConfirmDialogOptions } from "./ui/confirm-dialog.js";
export {
    jsonHeaders,
    bearer,
    fetchWithTimeout,
    parseJsonBody,
    HttpFetchError,
    type JsonHeadersOptions,
    type HttpFetchFailureKind,
} from "./http.js";
