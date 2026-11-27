/*!
 * @geoleaf-plugins/offline-ui — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 *
 * Façade only (INV-FACADE): the members a host may call on `GeoLeaf.UI.CacheButton`, the
 * object `ui/cache-button.ts` mounts on the core's `UI` façade. That object spreads
 * `buildPublicApi()` into itself, so what is declared here IS what is mounted; its other
 * members (`init`, `closeModal`, `Modules`) are wiring for the core and stay off the contract.
 * https://geoleaf.dev
 */
import { ModalManager, type OpenModalOptions } from "./ui/cache-button/modal-manager.js";

/**
 * Where this facade is mounted on the namespace. offline-ui owns no namespace of its own: it
 * adds a member to the core's `UI` façade. The consumer-contract gate reads this literal to
 * resolve `provider: "plugin:offline-ui"` paths against it.
 */
export const PUBLIC_API_MOUNT = "UI.CacheButton";

/** @internal Returns the public members mounted on `GeoLeaf.UI.CacheButton`. */
export function buildPublicApi() {
    return {
        /**
         * Opens the offline preparation window — the same call as the toolbar action.
         *
         * `{ mode: "simple" }` opens the field window: the choice of zone, the download with
         * its progress and its stop, the state in one line and the storage warning — nothing
         * that administers the cache. Without it, or with `"full"`, the whole window opens,
         * unchanged. An unknown mode is warned about and opens the whole window.
         *
         * @param options - `mode`: `"simple"` or `"full"` (default).
         * @example
         * GeoLeaf.UI.CacheButton.openModal();
         * GeoLeaf.UI.CacheButton.openModal({ mode: "simple" });
         */
        openModal: (options?: OpenModalOptions) => ModalManager.openModal(options),
    };
}
