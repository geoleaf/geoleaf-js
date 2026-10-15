/*!
 * @geoleaf/host-runtime — GPS position runtime seam
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The user's GPS position, as the core's `geolocation` capability holds it.
 *
 * The core keeps the permission, the watch and the last fix; a plugin reads them, it never calls
 * `navigator.geolocation` itself. Three plugins re-declared the shape of that state beside the
 * core, and one of them read three names that never existed there — `permission`, `position`,
 * `coordinates` —, so its « from my position » answered `no-fix` whatever the watch, with nothing
 * turning red. This module is the ONE declaration a plugin imports instead.
 *
 * ⚠️ It mirrors `GeolocationPublicApi` / `GeolocationStateSnapshot`
 * (`packages/core/src/capabilities/geolocation/public-api.ts`) and does not import them: this
 * package imports nothing from `@geoleaf/core`, not even a type (see `index.ts`).
 *
 * ⚠️ The GPS is switched on by CLICKING the core's own control, `.geoleaf-ctrl-geolocation a` —
 * hidden, but the only path through which the repository asks for the permission. That click
 * TOGGLES: it is made only when the watch is off.
 */

import { getGeoLeaf } from "./host.js";

/** A fix: degrees, and the accuracy in metres when the device gives it. */
export interface UserPosition {
    readonly lat: number;
    readonly lng: number;
    readonly accuracy?: number;
    readonly timestamp?: number;
}

/** What `GeoLeaf.Geolocation` exposes — the live state, never a copy. */
export interface GeolocationSeam {
    isEnabled?(): boolean;
    getState?(): { active: boolean; userPosition: UserPosition | null } | null | undefined;
}

/** The core's control: clicking its link starts — or stops — the watch. */
const CONTROL_LINK = ".geoleaf-ctrl-geolocation a";

/** Emitted on the map container, bubbling to `document`, with `{ active }` only. */
const STATE_CHANGE = "geoleaf:geolocation:statechange";

/** How long a first fix is waited for by default, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 20_000;

function seam(): GeolocationSeam | undefined {
    return getGeoLeaf()?.Geolocation as GeolocationSeam | undefined;
}

/**
 * Whether the GPS can be used here: the core's capability is mounted and the profile leaves it on.
 *
 * @returns `false` when the capability is absent or disabled by `modules.geolocation.enabled`.
 */
export function isGeolocationEnabled(): boolean {
    const geo = seam();
    return typeof geo?.getState === "function" && geo.isEnabled?.() !== false;
}

/**
 * Whether the core's watch is on — with or without a fix yet.
 *
 * ⚠️ Read this before clicking the core's control yourself: the click TOGGLES the watch, and a
 * plugin that clicks without asking switches off a GPS the user had switched on.
 *
 * @returns `false` when the capability is absent or the watch is off.
 */
export function isGeolocationActive(): boolean {
    return seam()?.getState?.()?.active === true;
}

/**
 * The last fix, while the watch is on.
 *
 * @returns The position, or `null` when the watch is off or has no fix yet — the core forgets
 *   the last fix as soon as the watch stops.
 */
export function readUserPosition(): UserPosition | null {
    const state = seam()?.getState?.();
    if (!state || state.active !== true || !state.userPosition) return null;
    const { lat, lng } = state.userPosition;
    return Number.isFinite(lat) && Number.isFinite(lng) ? state.userPosition : null;
}

/**
 * A fix, switching the GPS on if it is off.
 *
 * With a fix already held, resolves at once. Otherwise clicks the core's control — only when the
 * watch is off, the click toggling it — and waits for the first fix.
 *
 * ⚠️ The core tells a refusal and a timeout apart to nobody: both stop the watch and emit
 * `active: false`. Both resolve `null` here, as does this function's own timeout.
 *
 * @param options `timeoutMs`, how long the first fix is waited for (20 s by default).
 * @returns The position, or `null` when the GPS is unavailable, refused or too slow.
 * @example
 * const fix = await requestUserPosition();
 * if (fix) console.log(fix.lng, fix.lat);
 */
export function requestUserPosition(
    options: { timeoutMs?: number } = {}
): Promise<UserPosition | null> {
    const held = readUserPosition();
    if (held) return Promise.resolve(held);
    if (!isGeolocationEnabled() || typeof document === "undefined") return Promise.resolve(null);

    return new Promise((resolve) => {
        // `timer` is declared below and read here: `finish` only runs once an event or the click
        // can call it, both after the timer exists.
        const finish = (fix: UserPosition | null): void => {
            document.removeEventListener(STATE_CHANGE, onChange);
            clearTimeout(timer);
            resolve(fix);
        };
        // `active: true` comes with the FIRST fix only; `active: false` with a stop or an error.
        const onChange = (e: Event): void => {
            const active = (e as CustomEvent<{ active?: boolean }>).detail?.active;
            if (active === true) finish(readUserPosition());
            else if (active === false) finish(null);
        };
        // Listen BEFORE clicking: a fix already cached by the device can arrive synchronously.
        document.addEventListener(STATE_CHANGE, onChange);
        const timer = setTimeout(() => finish(null), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

        if (!isGeolocationActive()) {
            const link = document.querySelector<HTMLElement>(CONTROL_LINK);
            if (!link) {
                finish(null);
                return;
            }
            link.click();
        }
    });
}
