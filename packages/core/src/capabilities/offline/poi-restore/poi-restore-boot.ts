/*!
 * GeoLeaf Core (offline capability) — Offline POI Restore (boot wiring)
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Boot wiring for the offline POI restore (S9 D5). Kept separate from the pure
 * restore logic in `poi-restore.ts` so that logic stays side-effect-free and
 * unit-testable, while this module owns the DOM event lifecycle.
 */
import { restorePendingPois, type PoiRestoreDeps } from "./poi-restore.js";

/** Module guard so the boot listeners are attached at most once. */
let _attached = false;

/**
 * Attaches the boot listeners that push offline POIs onto their host layers.
 *
 * Listens on `geoleaf:layers:initial-loaded` (earliest — phase-1 host sources
 * exist) and replays on `geoleaf:app:ready` (net for deferred layers). Both
 * passes are idempotent. Attaches at most once; the returned function detaches.
 *
 * @param deps - Optional injected seams forwarded to {@link restorePendingPois}.
 * @returns A cleanup function that removes the listeners.
 */
export function registerPoiRestore(deps: PoiRestoreDeps = {}): () => void {
    if (typeof document === "undefined" || _attached) return () => {};
    _attached = true;
    const run = (): void => {
        void restorePendingPois(deps);
    };
    document.addEventListener("geoleaf:layers:initial-loaded", run);
    document.addEventListener("geoleaf:app:ready", run);
    return () => {
        document.removeEventListener("geoleaf:layers:initial-loaded", run);
        document.removeEventListener("geoleaf:app:ready", run);
        _attached = false;
    };
}
