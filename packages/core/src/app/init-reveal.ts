/*!
 * GeoLeaf Core – App / Init Reveal
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * App init: loader reveal + permalink apply + reveal triggers.
 * Extracted from app/init.ts — the reveal idempotence guard (`_appRevealed`)
 * is private to this module; behavior, performance marks and listener-registration
 * order are preserved (the reveal `theme:applied` listener is registered AFTER the
 * notification one, exactly as before).
 */

import type { RevealDeps } from "./app-types.js";
import { asFn, buildFitBoundsOptions, member } from "./app-types.js";
import { dispatchGeoLeafEvent } from "../kernel/events/event-bus.js";

/**
 * Whether the active profile declares a default theme. Drives the boot reveal signal:
 * themed profiles reveal on `geoleaf:theme:applied` (fully styled, no flash); theme-less
 * profiles reveal on the kernel's independent layer load (GeoJSONModule.init, F0/S8).
 * Mirrors the loader's `_resolveDefaultThemeId` (historical `defautTheme` config typo).
 * Returns `true` on uncertainty so the reveal never fires prematurely.
 */
function _profileHasDefaultTheme(GeoLeaf: GeoLeafGlobal): boolean {
    try {
        const getActiveProfile = asFn(member(GeoLeaf.Config, "getActiveProfile"));
        if (!getActiveProfile) return true;
        const profile = getActiveProfile.call(GeoLeaf.Config) as {
            themes?: { config?: { defautTheme?: string }; defaultTheme?: string };
        } | null;
        const themes = profile?.themes;
        if (!themes) return false;
        return !!(themes.config?.defautTheme || themes.defaultTheme);
    } catch {
        return true;
    }
}

/**
 * Wires the loader reveal: applies stored permalink state, then reveals the app
 * on `geoleaf:theme:applied` (or a 5 s safety timeout).
 * @param deps Shared boot dependencies passed by `initApp`.
 */
export function setupReveal({
    GeoLeaf,
    map,
    AppLog,
    profileBounds,
    profilePadding,
    permalinkCfg,
}: RevealDeps): void {
    // ========================================================
    // Reveal the application when layers are ready
    // The #gl-loader spinner stays opaque while the map
    // and GeoJSON layers load in the background.
    // We wait for the geoleaf:theme:applied event (= all
    // visible layers loaded) before revealing.
    // ========================================================
    let _appRevealed = false;
    function revealApp(reason: string) {
        if (_appRevealed) return;
        _appRevealed = true;
        const loader = document.getElementById("gl-loader");
        if (loader) {
            loader.classList.add("gl-loader--fade");
            // Remove from DOM after the CSS transition (400ms)
            // { once: true } ensures hide() is not called multiple times
            loader.addEventListener(
                "transitionend",
                function () {
                    loader.style.display = "none";
                },
                { once: true }
            );
            // Fallback if transitionend does not fire — 800ms > transition duration
            // (value > transition duration to let transitionend execute first)
            setTimeout(function () {
                loader.style.display = "none";
            }, 800);
        }

        // After removing the loader, tell the engine to recalculate its container
        // size and re-fit the profile bounds (unless permalink state overrides).
        if (map) {
            // Trigger MapLibre resize() to recalculate the container dimensions.
            // Both methods are called BOUND to their source object (a detached call
            // loses `this`): getNativeMap to `map`, resize to the resolved native map.
            const nativeMap = asFn(map.getNativeMap)?.call(map);
            const resize = asFn(member(nativeMap, "resize"));
            if (resize) {
                resize.call(nativeMap);
            }

            const permalink = GeoLeaf.Permalink;
            const getState = asFn(member(permalink, "getState"));
            const _hasPermalink =
                permalinkCfg.enabled !== false &&
                typeof permalink !== "undefined" &&
                !!getState &&
                getState.call(permalink) !== null;
            if (profileBounds && !_hasPermalink && typeof map.fitBounds === "function") {
                const boundsToFit = profileBounds;
                const fitOptions = buildFitBoundsOptions(profilePadding);
                setTimeout(function () {
                    try {
                        map.fitBounds(boundsToFit, fitOptions);
                    } catch (e) {
                        AppLog.warn("[GeoLeaf] fitBounds correction at reveal:", e);
                    }
                }, 120);
            }
        }

        dispatchGeoLeafEvent("geoleaf:map:ready", undefined);
        // Emit the application initialisation end event
        // (used by boot.js to display the boot toast via GeoLeaf.bootInfo)
        const bootVersion = GeoLeaf._version;
        dispatchGeoLeafEvent("geoleaf:app:ready", {
            ...(bootVersion !== undefined && { version: bootVersion }),
            timestamp: Date.now(),
        });
        AppLog.info("Application ready: " + reason);
        // perf 5 — benchmark: total startup time measurement
        if (typeof performance !== "undefined" && performance.mark) {
            performance.mark("geoleaf:initApp:ready");
            try {
                performance.measure(
                    "geoleaf:startup-total",
                    "geoleaf:initApp:start",
                    "geoleaf:initApp:ready"
                );
                const last = performance
                    .getEntriesByName("geoleaf:startup-total", "measure")
                    .at(-1);
                if (last) {
                    AppLog.info("[Perf] ? Startup total: " + last.duration.toFixed(1) + "ms");
                }
            } catch (error) {
                void error;
            }
        }
    }

    // ── Permalink hook 2 (§1.3.2): apply stored URL state + start sync ─────
    // Called after all modules are initialised but before the reveal,
    // so the view override is applied before the app becomes visible.
    if (permalinkCfg.enabled !== false && GeoLeaf.Permalink) {
        try {
            const permalink = GeoLeaf.Permalink;
            asFn(member(permalink, "applyStoredState"))?.call(permalink, map);
            asFn(member(permalink, "startSync"))?.call(permalink, map);
        } catch (e) {
            AppLog.warn("[Permalink] applyStoredState/startSync failed:", e);
        }
    }

    // Wait for all theme layers to be loaded
    document.addEventListener(
        "geoleaf:theme:applied",
        function () {
            revealApp("theme applied, layers loaded");
        },
        { once: true }
    );
    // F0 (S8): a profile WITHOUT a default theme never fires `geoleaf:theme:applied`.
    // Its layers are loaded independently by `GeoJSONModule.init()` (registry phase,
    // already completed before this reveal runs) — reveal now instead of falling back to
    // the 5 s safety net (deferred layers stream in during idle). `revealApp` is
    // idempotent, so the theme path above still wins for themed profiles.
    if (!_profileHasDefaultTheme(GeoLeaf)) {
        revealApp("layers loaded (no default theme)");
    }
    // Safety: reveal after 5s max (slow network, error…) — perf 5.10: reduced from 15s to 5s
    setTimeout(function () {
        revealApp("safety timeout 5s");
    }, 5000);
}
