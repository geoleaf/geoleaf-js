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
 *
 * The reveal dispatches `geoleaf:app:ready`, and the capabilities mount on it — so it must never
 * run before the registry has run their `init()`. A themed profile reveals on
 * `geoleaf:theme:applied`, which `theme-engine`, the last module of the registry, dispatches. A
 * profile without a default theme has its reveal ARMED here and released by the boot once
 * `registry.init()` has returned ({@link releaseThemelessReveal}).
 */

import type { RevealDeps } from "./app-types.js";
import { asFn, buildFitBoundsOptions, member } from "./app-types.js";
import { dispatchGeoLeafEvent } from "../kernel/events/event-bus.js";
import { holdReveal } from "./boot-failure.js";
import { markAppReady } from "../kernel/shared/app-ready.js";
import { resolveDefaultThemeId } from "../kernel/config/default-theme.js";

/**
 * The reveal of a profile without a default theme, armed by the last {@link setupReveal} and
 * released by {@link releaseThemelessReveal}. `null` when nothing is armed.
 */
let _pendingThemelessReveal: (() => void) | null = null;

/**
 * Whether the active profile starts on a theme. Drives the boot reveal signal: themed profiles
 * reveal on `geoleaf:theme:applied` (fully styled, no flash); profiles without any theme reveal
 * once the registry has run every module (their layers were loaded by `GeoJSONModule.init`,
 * F0/S8) — see {@link releaseThemelessReveal}.
 *
 * Resolved like every other reader (`kernel/config/default-theme.ts`): a `themes` list without a
 * declared default starts on `themes[0]`, which `theme-engine` applies — so it waits for it.
 * Returns `true` on uncertainty so the reveal never fires prematurely.
 */
function _profileHasDefaultTheme(GeoLeaf: GeoLeafGlobal): boolean {
    try {
        const getActiveProfile = asFn(member(GeoLeaf.Config, "getActiveProfile"));
        if (!getActiveProfile) return true;
        const profile = getActiveProfile.call(GeoLeaf.Config) as { themes?: unknown } | null;
        return resolveDefaultThemeId(profile?.themes) !== null;
    } catch {
        return true;
    }
}

/**
 * Fades the app shell's `#gl-loader` veil out, then takes it out of the flow.
 *
 * Called by the reveal below, and by the boot when a `beforeBoot` hook aborts it — the host
 * owns what comes next, and a veil left up would cover it. A page without a veil (a host
 * embedding the library) is left untouched.
 */
export function hideBootVeil(): void {
    const loader = document.getElementById("gl-loader");
    if (!loader) return;
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

/**
 * Wires the loader reveal: applies stored permalink state, then reveals the app
 * on `geoleaf:theme:applied` (or a 5 s safety timeout). For a profile without a default theme,
 * the reveal is armed instead, and the boot releases it once `registry.init()` has returned
 * ({@link releaseThemelessReveal}) — whichever comes first reveals, and only once.
 *
 * The reveal asks `holdReveal()` (`boot-failure.ts`) first: a failed boot keeps its failure
 * screen, and declared profile resources that failed hold the reveal on a screen whose
 * « Continue » replays it.
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
        if (holdReveal(() => revealApp(reason))) return;
        _appRevealed = true;
        // Before the dispatches: a capability initialised from here on mounts at once.
        markAppReady();
        hideBootVeil();

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
    // F0 (S8): a profile WITHOUT a default theme may never fire `geoleaf:theme:applied`.
    // Its layers are loaded independently by `GeoJSONModule.init()` (registry phase,
    // already completed before this runs), so it does not wait for the 5 s safety net.
    //
    // 🛑 But it does NOT reveal here. This runs inside `UIModule.init()`, and the registry runs
    // every capability module that depends on `geojson` alone AFTER `ui` — legend, scale,
    // coordinates, filter, theme-selector… Revealing here dispatched `geoleaf:app:ready` before
    // they had subscribed to it, and none of them ever mounted, in silence. A microtask would not
    // do either: the registry awaits each `init()`, so it would still run before the loop
    // resumes. The reveal is armed, and the boot releases it after `registry.init()`.
    //
    // When `themes` exists without `defaultTheme`, the theme loader falls back to `themes[0]`:
    // `theme-engine` applies it inside the registry, the listener above reveals first, and the
    // release is a no-op (`revealApp` is idempotent).
    _pendingThemelessReveal = _profileHasDefaultTheme(GeoLeaf)
        ? null
        : () => revealApp("layers loaded (no default theme)");
    // Safety: reveal after 5s max (slow network, error…) — perf 5.10: reduced from 15s to 5s
    setTimeout(function () {
        revealApp("safety timeout 5s");
    }, 5000);
}

/**
 * Releases the reveal of a profile without a default theme, armed by {@link setupReveal}.
 *
 * Called by the boot once `registry.init()` has returned, i.e. once every module has run its
 * `init()` and every capability has subscribed to `geoleaf:app:ready`. Does nothing when nothing
 * is armed (a themed profile), and nothing more when the app is already revealed.
 */
export function releaseThemelessReveal(): void {
    const reveal = _pendingThemelessReveal;
    _pendingThemelessReveal = null;
    reveal?.();
}
