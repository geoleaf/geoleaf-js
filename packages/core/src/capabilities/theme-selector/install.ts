/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `theme-selector` capability — presets build (S2 Lot 8).
 *
 * 🖐 **No `public-api.ts` — and the motive written here was FALSE until
 * 20/08/2026.** It said "this capability mounts no namespace". It mounts one:
 * `registerGlobals` writes `gl.ThemeSelector`, and the symbol comes from this
 * directory — so it is indeed an OWN surface, declared moreover in `global.d.ts`. A
 * `public-api.ts` would have something to re-export, which removes the "shell"
 * argument.
 *
 * ⚠️ The question is therefore REOPENED, not settled: adding a `public-api.ts` puts
 * a name into a published surface, and that gets decided. What is fixed here is only
 * the sentence — a false motive engraved in code is harder to contradict than in a
 * register, because it reads as a decision already taken.
 *
 * 📌 `route` is the ONLY one of the four facade-less capabilities that mounts
 * nothing at all.
 *
 * ⚠️ **Not to be confused with `api/geoleaf.theme-toggle.ts`**, a very real public
 * facade that does not live here. 🔗 This capability also remains the sole emitter
 * of `geoleaf:themes:ready`, which the permalink awaits **with no fallback** — a
 * distinct fact, independent of this arbitration.
 *
 * The **last** of the 17 in-core capabilities to migrate: it was pulled out of Lot 2 because
 * its DOM facade spans 6 files and its coverage came from a fragile, incidental full-boot
 * path. `__tests__/capabilities/theme-selector/mount.test.js` (S2 Lot 8) now mounts the bar
 * for real — that deterministic mount coverage was the precondition for this move.
 *
 * ⚠ **The theme ENGINE stays kernel.** Only `GeoLeaf.ThemeSelector` (the switch bar UI)
 * moves here. `ThemeCache`, `_ThemeLoader` and `_ThemeApplier` (`kernel/themes/**`)
 * remain in `globals.ui.ts`: they are the engine that applies the profile's default theme
 * (via `ThemeEngineModule`, kernel and unconditional) and the facade below consumes them.
 * Same rule as `theme-toggle`, whose installer leaves `_UITheme` / `ui.applyTheme` behind.
 *
 * ⚠ The Lite bundle keeps its own assignment (`globals.ui-lite.ts`) — it does not go through
 * a preset manifest.
 */

// ── Stylesheet (S6) ─────────────────────────────────────────────────────────
// The capability owns its CSS and pulls it into the module graph from HERE — the one module
// a consumer must import to get this capability at all. Skip the installer and the stylesheet
// is never in the graph either: the CSS tree-shakes with the code.
import "./css/theme-selector.css";

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { THEME_SELECTOR_CAPABILITY } from "./theme-selector-capability.js";
// The boot wrapper now lives INSIDE this capability (backlog R.10) — no app/ path,
// no exception, and the ICoreModule lifecycle is co-located with what it drives.
import { ThemeSelectorModule } from "./module.js";
import { ThemeSelector } from "./theme-selector.js";

/** Self-sufficient installer for the Theme-Selector capability (theme switch bar). */
export const THEME_SELECTOR_INSTALLER: CapabilityInstaller = {
    declaration: THEME_SELECTOR_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        // Layer B — moved verbatim from globals.ui.ts (setupUI, B7 block). The neighbouring
        // theme-engine writes (ThemeCache / _ThemeLoader / _ThemeApplier) stay there.
        //
        // Re-measured 24/08/2026 — this capability DOES mount a namespace of its own, so the
        // earlier "empty shell" premise for skipping a `public-api.ts` was false. The
        // decision to skip it is KEPT anyway, on its real ground: this direct mount is
        // functionally identical to a re-export file, `GeoLeaf.ThemeSelector` is already
        // declared in `global.d.ts` and frozen by the surface oracles, and conforming a
        // stable shipped file to an internal pattern would change no observable byte. If a
        // second consumer of this surface ever appears inside the package, that is the
        // moment a `public-api.ts` earns its place.
        gl.ThemeSelector = ThemeSelector;
    },

    createModule() {
        return new ThemeSelectorModule();
    },
};
