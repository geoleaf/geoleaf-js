/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Theme-selector capability — lifecycle / event wiring (S8/F2).
 *
 * Builds the theme switch bar (primary buttons + secondary dropdown) and reflects
 * the active theme. The data-dependent mount is deferred to `geoleaf:app:ready`
 * (layers loaded + default theme applied by ThemeEngineModule), through `whenAppReady()`:
 * an init that runs after the reveal mounts at once.
 *
 * The DEFAULT theme is applied by ThemeEngineModule (kernel) — this only builds the
 * UI and reflects the current theme; `ThemeSelector.init` no longer applies (F2).
 * Registered by `ThemeSelectorModule` when the `theme-selector` capability is enabled
 * (`modules.theme-selector.enabled === true`, **opt-in** — S8/F3).
 *
 * ⚠️ These two lines said "opt-out" and cited a `!== false` test that no longer
 * exists. The DECLARATION gate, however, is indeed `enableWhenAbsent: true` — the
 * two stages answer two different questions, which is why the "opt-out boot gate"
 * mention in `theme-selector.ts` is RIGHT and was not touched.
 *
 * `ThemeSelectorModule` depends on `geojson` (not `ui`/`theme-engine`) so this init()
 * — and thus the `app:ready` subscription below — runs BEFORE ThemeEngineModule
 * dispatches `geoleaf:theme:applied` → `geoleaf:app:ready`.
 *
 * 🛑 This header concluded « so the event is caught ». On a profile without a default theme
 * it was not: that reveal ran inside `UIModule.init()`, before this module, and the bar never
 * mounted. The reveal now waits for the end of `registry.init()`, and `whenAppReady()` no
 * longer needs the subscription to arrive first.
 */

import { ThemeSelector } from "./theme-selector.js";
import { Log } from "../../utils/log/index.js";
import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { whenAppReady } from "../../kernel/shared/index.js";

let _started = false;

/**
 * Mounts the theme switch bar once the app (data) is ready. Acceptance guard:
 * an active profile and both theme containers must be present (same gate the
 * pre-F2 `initGeoJSON` used); otherwise nothing mounts.
 */
function _onAppReady(): void {
    if (typeof document === "undefined") return;

    const config = getGeoLeaf()?.Config as { getActiveProfileId?: () => unknown } | undefined;
    const profileId =
        typeof config?.getActiveProfileId === "function" ? config.getActiveProfileId() : null;

    const primaryContainer = document.getElementById("gl-theme-primary-container");
    const secondaryContainer = document.getElementById("gl-theme-secondary-container");

    if (typeof profileId !== "string" || !profileId || !primaryContainer || !secondaryContainer) {
        return;
    }

    ThemeSelector.init({ profileId, primaryContainer, secondaryContainer }).catch((e: unknown) => {
        Log?.warn?.("[ThemeSelector] init failed:", (e as Error)?.message);
    });
}

/** Idempotent event wiring for the theme-selector capability. Safe to call twice. */
export const ThemeSelectorLifecycle = {
    init(): void {
        if (_started || typeof document === "undefined") return;
        _started = true;
        // Deferred to app:ready (layers + default theme ready) — at once if the app is already.
        whenAppReady(_onAppReady);
    },

    /** Detaches the listener and tears down the selector (module destroy / test). */
    _reset(): void {
        if (typeof document !== "undefined") {
            document.removeEventListener("geoleaf:app:ready", _onAppReady);
        }
        ThemeSelector.destroy();
        _started = false;
    },
};
