/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Whether the application has been revealed — `geoleaf:app:ready` dispatched for the current
 * boot — and the way to run something once it has.
 *
 * `geoleaf:app:ready` is a one-shot DOM event with no replay: a `{ once: true }` listener added
 * after it fired waits forever, in silence. The capabilities that mount on it used to add that
 * listener in their module `init()` and rely on the registry to run the init BEFORE the event.
 * That held on a themed boot only: a profile without a default theme revealed from inside
 * `UIModule.init()`, before every capability module the registry runs after `ui`, and the
 * legend, the scale bar, the coordinates readout, the filter panel and the theme bar never
 * mounted. The reveal now waits for the end of the registry (`app/init-reveal.ts`);
 * {@link whenAppReady} makes the arrival order irrelevant on top of it — an init that runs after
 * the reveal mounts at once.
 *
 * The flag is written by the reveal and cleared at the start of every boot (`app/boot-core.ts`)
 * and by `Core.destroy()`, through the lifecycle teardown seam: without the latter, a map
 * recreated after a destroy would read the previous boot's « ready » and mount its capabilities
 * before its own reveal.
 */

import { registerLifecycleTeardown } from "./lifecycle.js";

let _ready = false;

/** Clears the flag: a new boot starts, or the last map was destroyed. */
export function resetAppReady(): void {
    _ready = false;
}

/**
 * Marks the application ready. Called by the reveal just before it dispatches
 * `geoleaf:map:ready` and `geoleaf:app:ready`.
 */
export function markAppReady(): void {
    _ready = true;
    // A Set: registering on every boot is idempotent.
    registerLifecycleTeardown(resetAppReady);
}

/**
 * Runs `listener` once the application is ready: at once when `geoleaf:app:ready` has already
 * been dispatched for this boot, otherwise on that event, a single time.
 *
 * The listener is added as given, so a caller that detaches it with
 * `document.removeEventListener("geoleaf:app:ready", listener)` keeps working.
 *
 * @param listener - What to run when the application is ready.
 */
export function whenAppReady(listener: () => void): void {
    if (_ready) {
        listener();
        return;
    }
    if (typeof document === "undefined") return;
    document.addEventListener("geoleaf:app:ready", listener, { once: true });
}
