/*!
 * @geoleaf-plugins/position-share — Boot wiring
 *
 * Defers everything that depends on the built application to `geoleaf:app:ready`: the `auto`
 * mode's watch request, and the reception the profile may ask for. Running any of it at module
 * load would look for a geolocation control that the app has not yet put in the DOM — and a
 * missing element is not an error, so the failure would leave no trace at all.
 *
 * And takes it all down when the application is unmounted ({@link destroyLifecycle}): the
 * emission loop is a timer of this module, not of the map — nothing else stops it.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { getNativeMap } from "@geoleaf/host-runtime";

import { getPluginConfig } from "./config.js";
import { startEmission, stopEmission } from "./emitter.js";
import { ensureWatch, isWatchActive, notifyDeniedOnce, resetWatchRequest } from "./gps-watch.js";
import { initReceive, stopReceive } from "./receive.js";

/** How long to wait before concluding that a permission prompt was refused. */
const PERMISSION_GRACE_MS = 8000;

let _wired = false;
/** The boot-time work was done for the application now alive. Released by the teardown. */
let _ran = false;
/** The pending grace period of `auto`, so the teardown can cancel it. */
let _graceTimer: ReturnType<typeof setTimeout> | null = null;

function startAuto(): void {
    const cfg = getPluginConfig();
    if (cfg.enabled !== true || cfg.mode !== "auto") return;

    ensureWatch();

    // The watch turns active asynchronously — the browser prompt sits between the click and the
    // first fix. Emission is therefore attempted after a grace period rather than immediately;
    // `startEmission` is a no-op if it fails, and the loop re-reads the state every cycle.
    _graceTimer = setTimeout(() => {
        _graceTimer = null;
        if (!isWatchActive()) {
            notifyDeniedOnce();
            return;
        }
        startEmission();
    }, PERMISSION_GRACE_MS);
}

/**
 * The boot-time work, guarded so the listener and the late-load fallback cannot both run it —
 * once per application: the teardown releases the guard.
 */
function run(): void {
    if (_ran) return;
    _ran = true;
    startAuto();
    // Independent of emission: an integrator can display the fleet without emitting anything
    // themselves — a dispatcher's screen is exactly that case.
    initReceive();
}

/**
 * Wires the boot-time behaviour: `auto` emission, and reception when the profile asks for it.
 *
 * It waits for `geoleaf:app:ready` rather than running at module load. The geolocation control
 * is not in the DOM until the app has built its chrome, so clicking it earlier finds nothing —
 * a failure that leaves no trace, because a missing element is not an error. `setTimeout(0)` is
 * not enough either; this is the same timing lesson the repository has already paid for.
 *
 * 🛑 **And the listener alone is NOT enough, because this plugin is loaded LAZILY.** The app
 * registers it with `registerLazy`, so its import can happen long after `geoleaf:app:ready` has
 * fired — and an listener added to a signal that already passed never runs. The failure is
 * entirely silent: no error, no trace, `auto` and reception simply never start, which is
 * indistinguishable from a plugin nobody asked for. This is the class that closed twice in this
 * repository, on `realtime-layer` and then `geocoding`.
 *
 * The fallback is therefore explicit: if the map already exists, boot is behind us and the work
 * runs immediately instead of waiting for a signal that will not come again.
 *
 * ⚠️ **The listener stays for the life of the page.** It was `{ once: true }`: an application
 * unmounted and mounted again (`GeoLeaf.mount()`) boots a second time, and nothing started
 * `auto` or the reception for it.
 */
export function initLifecycle(): void {
    if (_wired) return;
    _wired = true;

    if (typeof document === "undefined") return;
    document.addEventListener("geoleaf:app:ready", run);

    // Late-load fallback — same shape as `editor`'s, on the seam that says boot is done.
    if (getNativeMap()) run();
}

/**
 * Takes down what this plugin runs for the application that goes away — the application
 * teardown (`GeoLeaf.mount()`'s `unmount()`) reaches it through the module the entry registers.
 *
 * 🛑 **The emission loop is the reason this exists.** It is an interval of this module: the map
 * can be destroyed, the toolbar and its button removed, and the loop goes on. A host that
 * unmounted the map kept a timer that sent the user's position again as soon as a geolocation
 * watch was active, `isEmitting()` answering `true` all along, and the badge stayed in the
 * container of a map that no longer existed.
 *
 * Stops the loop and its transport, removes the badge, cancels the pending grace period of
 * `auto`, stops the reception this plugin started, and releases the two guards so the next
 * application's `geoleaf:app:ready` starts `auto` and the reception again. Emission started by
 * hand is NOT resumed: the user turns it on, on the application in front of them.
 */
export function destroyLifecycle(): void {
    if (_graceTimer) {
        clearTimeout(_graceTimer);
        _graceTimer = null;
    }
    stopEmission();
    stopReceive();
    resetWatchRequest();
    _ran = false;
}
