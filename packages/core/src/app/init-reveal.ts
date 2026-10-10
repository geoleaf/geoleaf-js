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
 * What {@link hideBootVeil} left pending — the `transitionend` listener and its 800 ms fallback —
 * so that {@link showBootVeil} can cancel it: a hide still pending from the previous boot would
 * otherwise take the veil down again under the next one.
 */
let _veilHide: {
    loader: HTMLElement;
    onEnd: () => void;
    timer: ReturnType<typeof setTimeout>;
} | null = null;

/** `true` once the core has hidden the veil — the only veil {@link showBootVeil} puts back. */
let _veilHiddenByCore = false;

function _cancelVeilHide(): void {
    if (!_veilHide) return;
    _veilHide.loader.removeEventListener("transitionend", _veilHide.onEnd);
    clearTimeout(_veilHide.timer);
    _veilHide = null;
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
    _cancelVeilHide();
    _veilHiddenByCore = true;
    loader.classList.add("gl-loader--fade");
    const onEnd = function (): void {
        loader.style.display = "none";
        _cancelVeilHide();
    };
    // Remove from the flow after the CSS transition (400 ms) — or after 800 ms, should
    // `transitionend` not fire (a value above the transition lets the event run first).
    loader.addEventListener("transitionend", onEnd, { once: true });
    _veilHide = { loader, onEnd, timer: setTimeout(onEnd, 800) };
}

/**
 * Puts back the veil {@link hideBootVeil} took down — called at the start of every boot, so an
 * application mounted again shows its veil while it starts, as the first one did, and a failure
 * screen is drawn into a visible veil. Does nothing when the core never hid it: a veil a host
 * manages itself is none of the boot's business.
 */
export function showBootVeil(): void {
    _cancelVeilHide();
    if (!_veilHiddenByCore) return;
    _veilHiddenByCore = false;
    const loader = document.getElementById("gl-loader");
    if (!loader) return;
    loader.classList.remove("gl-loader--fade");
    loader.style.display = "";
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
 * @returns The teardown `UIModule.destroy()` runs when the application is unmounted: the
 *   listener, the safety timer, the fit timer and an armed themeless reveal go, and nothing
 *   reveals any more. Without it, the reveal of a boot unmounted before it revealed fired on the
 *   next boot's `geoleaf:theme:applied` — an `app:ready` for an application that was gone.
 */
export function setupReveal({
    GeoLeaf,
    map,
    AppLog,
    profileBounds,
    profilePadding,
    permalinkCfg,
}: RevealDeps): () => void {
    // ========================================================
    // Reveal the application when layers are ready
    // The #gl-loader spinner stays opaque while the map
    // and GeoJSON layers load in the background.
    // We wait for the geoleaf:theme:applied event (= all
    // visible layers loaded) before revealing.
    // ========================================================
    let _appRevealed = false;
    /** Set by the teardown: the application is gone, and this reveal never runs again. */
    let _ended = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    function revealApp(reason: string) {
        if (_appRevealed || _ended) return;
        if (holdReveal(() => revealApp(reason))) return;
        _appRevealed = true;
        // Before the dispatches: a capability initialised from here on mounts at once.
        markAppReady();
        hideBootVeil();

        // After removing the loader, tell the engine to recalculate its container
        // size and re-fit the profile bounds (unless permalink state overrides).
        //
        // 🛑 BEFORE THE ANNOUNCEMENTS, AND SYNCHRONOUSLY. The re-fit used to wait 120 ms in a
        // timer — a delay no line ever justified — and so landed AFTER `geoleaf:app:ready`: a
        // host setting its view at the event that says "ready" saw it undone. `resize()` has
        // just given the engine its container's size, the fit is not animated, and whoever
        // listens below receives a camera nothing of the boot will move again.
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
                try {
                    map.fitBounds(profileBounds, buildFitBoundsOptions(profilePadding));
                } catch (e) {
                    AppLog.warn("[GeoLeaf] fitBounds correction at reveal:", e);
                }
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
    const onThemeApplied = function (): void {
        revealApp("theme applied, layers loaded");
    };
    document.addEventListener("geoleaf:theme:applied", onThemeApplied, { once: true });
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
    const themelessReveal = _profileHasDefaultTheme(GeoLeaf)
        ? null
        : () => revealApp("layers loaded (no default theme)");
    _pendingThemelessReveal = themelessReveal;
    // Safety: reveal after 5s max (slow network, error…) — perf 5.10: reduced from 15s to 5s
    timers.push(
        setTimeout(function () {
            revealApp("safety timeout 5s");
        }, 5000)
    );

    return function teardownReveal(): void {
        _ended = true;
        document.removeEventListener("geoleaf:theme:applied", onThemeApplied);
        for (const timer of timers) clearTimeout(timer);
        timers.length = 0;
        if (_pendingThemelessReveal === themelessReveal) _pendingThemelessReveal = null;
    };
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
