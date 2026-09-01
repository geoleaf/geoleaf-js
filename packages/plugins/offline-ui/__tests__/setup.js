/**
 * Vitest global setup for @geoleaf-plugins/offline-ui tests
 *
 * ## Ce qu'il reste, et pourquoi
 *
 * 1. **`jest` → `vi`: removed on 18/08/2026** — no `jest.*` call left in the
 *    package, the alias only served to make possible what we no longer want to
 *    write.
 * 2. **The `globalThis.GeoLeaf.Utils` seam.** This is NOT module resolution: the
 *    sources read the core's utilities on this surface, which the core mounts at
 *    boot in production (`globals.core.ts` B2). The tests must mount it too,
 *    otherwise the accessors return their neutral fallback and assertions fail.
 *    Nothing makes it unnecessary.
 *
 * ## What was removed, and on what proof
 *
 * This file carried **227 lines**, ~150 of them resolution: a
 * `Module._resolveFilename` patch aliasing `@core/*`, `@core-offline/*`,
 * `@geoleaf/field-renderer`, the `indexeddb.js` and `cache-control.js` variants,
 * plus a `.js → .ts` fallback. Its header stated its own raison d'être: "Vite
 * alias directives are NOT applied to transitive source imports in forks+tsx
 * mode". That premise falls with the `require()` branch.
 *
 * **Removed on measurement, not reasoning**: a probe compared, at every call,
 * what the patch returned to what a pristine resolution would have. Over the
 * package's 7 files and 90 tests, it installed 7 times and recorded **no
 * redirection**.
 *
 * ⚠️ What the patch did falls back to `vitest.config.ts`, and the equivalence
 * was not a given: `resolveJsToTs` rewrites `.js` → `.ts` in source files, so an
 * alias declared for `.js` alone never reaches them. This package had already
 * anticipated it for `cache-control.(js|ts)`; the `@geoleaf/field-renderer`
 * entry had to be added.
 *
 * ⚠️ **That alias entry no longer exists**: `confirmDialog` and
 * `createFocusTrap` left `field-renderer` for `host-runtime`, and the package
 * lost any `field-renderer` dependency. The alias now targets
 * `@geoleaf/host-runtime`, with a **partial** mock — nine symbols are consumed
 * there, not three. The account above stays true *in the past tense*; the note
 * avoids a hunt for a vanished entry.
 */

// ── 1. jest → vi alias : REMOVED (2026-08-18) ─────────────────────────────────
// The `__mocks__/*.js` spies that needed it were converted to `vi.fn()` long before this
// removal — measured: zero `jest.*` calls remain in the package. See the core setup for
// why a caller-less global alias is a liability rather than a harmless leftover.

// ── 2. GeoLeaf.Utils seam ─────────────────────────────────────────────────────
// The implementations come from the same `__mocks__/` as the Vite aliases, so
// the behaviour the tests observe is unchanged.
import * as domSecurity from "../__mocks__/dom-security.js";
import * as domHelpers from "../__mocks__/dom-helpers.js";
import * as formatters from "../__mocks__/formatters.js";
import * as elm from "../__mocks__/event-listener-manager.js";

globalThis.GeoLeaf = globalThis.GeoLeaf || {};
globalThis.GeoLeaf.Utils = {
    ...(globalThis.GeoLeaf.Utils || {}),
    DOMSecurity: domSecurity.DOMSecurity ?? domSecurity,
    applyCssText: domHelpers.applyCssText,
    createElement: domHelpers.createElement ?? domHelpers.$create,
    Formatters: {
        formatDateTime: formatters.formatDateTime,
        toMB: formatters.toMB,
        toGB: formatters.toGB,
    },
    events: elm.events ?? elm.EventListenerManager,
};
