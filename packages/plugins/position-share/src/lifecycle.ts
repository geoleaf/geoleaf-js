/*!
 * @geoleaf-plugins/position-share — Boot wiring
 *
 * Defers everything that depends on the built application to `geoleaf:app:ready`: the `auto`
 * mode's watch request, and the reception the profile may ask for. Running any of it at module
 * load would look for a geolocation control that the app has not yet put in the DOM — and a
 * missing element is not an error, so the failure would leave no trace at all.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { getNativeMap } from "@geoleaf/host-runtime";

import { getPluginConfig } from "./config.js";
import { startEmission } from "./emitter.js";
import { ensureWatch, isWatchActive, notifyDeniedOnce } from "./gps-watch.js";
import { initReceive } from "./receive.js";

/** How long to wait before concluding that a permission prompt was refused. */
const PERMISSION_GRACE_MS = 8000;

let _wired = false;
let _ran = false;

function startAuto(): void {
    const cfg = getPluginConfig();
    if (cfg.enabled !== true || cfg.mode !== "auto") return;

    ensureWatch();

    // The watch turns active asynchronously — the browser prompt sits between the click and the
    // first fix. Emission is therefore attempted after a grace period rather than immediately;
    // `startEmission` is a no-op if it fails, and the loop re-reads the state every cycle.
    setTimeout(() => {
        if (!isWatchActive()) {
            notifyDeniedOnce();
            return;
        }
        startEmission();
    }, PERMISSION_GRACE_MS);
}

/** The boot-time work, guarded so the listener and the late-load fallback cannot both run it. */
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
 */
export function initLifecycle(): void {
    if (_wired) return;
    _wired = true;

    if (typeof document === "undefined") return;
    document.addEventListener("geoleaf:app:ready", run, { once: true });

    // Late-load fallback — same shape as `editor`'s, on the seam that says boot is done.
    if (getNativeMap()) run();
}
