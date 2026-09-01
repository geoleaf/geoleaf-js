/*!
 * @geoleaf-plugins/position-share — GPS watch activation
 *
 * Starts the core's GPS watch when it is not already running, by clicking the geolocation
 * control programmatically. That detour is a browser constraint and not a design choice:
 * geolocation is only granted from a user gesture, and the core wires that gesture to its own
 * control. This module also reports a refused permission, exactly once per session.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { getGeoLeaf, Log } from "@geoleaf/host-runtime";

/** The slice of `GeoLeaf.Geolocation` read here. */
interface GeolocationSurface {
    getState?: () => { active: boolean };
}

let _requested = false;
let _deniedNotified = false;

/** True when the core's GPS watch is running. */
export function isWatchActive(): boolean {
    const geo = getGeoLeaf()?.Geolocation as GeolocationSurface | undefined;
    return geo?.getState?.().active === true;
}

/**
 * Starts the core's GPS watch if it is not already running, by clicking the geolocation
 * control programmatically.
 *
 * **This detour is a browser constraint, not a design choice, and no design removes it.**
 * Emitting needs an active watch; the watch needs a granted permission; and browsers only grant
 * it from a user gesture, which the core wires to that control. Clicking it by program is the
 * idiom already used by `packages/plugins/measure/src/tools/tool-gps.ts` and by the mobile
 * toolbar — reproducing the permission request here would mean a second prompt path with its
 * own state.
 *
 * In `auto` mode the click happens without the user having asked for it. If the browser has
 * no stored grant, they see a permission prompt at boot. That is the honest cost of `auto`, and
 * it is why the mode is not the default.
 *
 * @returns `true` when the watch is active or a request was issued, `false` when the control is
 *   absent from the DOM.
 */
export function ensureWatch(): boolean {
    if (isWatchActive()) return true;
    if (_requested) return true;

    if (typeof document === "undefined") return false;
    const link = document.querySelector<HTMLAnchorElement>(".geoleaf-ctrl-geolocation a");
    if (!link) {
        Log.warn(
            "[PositionShare] geolocation control not in the DOM — is the geolocation " +
                "capability enabled in the profile?"
        );
        return false;
    }

    _requested = true;
    link.click();
    return true;
}

/**
 * Reports a refused permission, at most once per session.
 *
 * Once, because the loop runs every `intervalMs`: a refusal repeated every 30 seconds turns a
 * decision the user already made into noise, and buries anything else in the console.
 */
export function notifyDeniedOnce(): void {
    if (_deniedNotified) return;
    _deniedNotified = true;
    Log.warn(
        "[PositionShare] location permission refused — no position will be emitted this session"
    );
}
