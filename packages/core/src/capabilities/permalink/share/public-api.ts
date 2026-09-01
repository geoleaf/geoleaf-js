/*!
 * GeoLeaf Core (share capability) — public API surface
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Share capability — public API surface.
 *
 * Builds the object mounted on `GeoLeaf.Share`.
 *
 * ⚠️ This header named the « Lite build » until 2026-08-19. **That build no longer exists** — its removal is motivated where it happened, in the bundle configuration, and the alternate mounting site these headers implied does not exist either. A build distinction that is gone does not read as stale: it reads as a live constraint, and a reader plans around it. Here it announced an EXCLUSION — a reader would look for the graph it names.
 *
 * Exposes
 * the modal controls (`openShareDialog` / `closeShareDialog` / `isOpen` / `getShareUrl`)
 * plus capability read helpers (`isEnabled` / `getConfig`) for integrators / no-code
 * studio.
 */

import { buildShareUrl } from "./share-link.js";
import { openShareModal, closeShareModal, isShareModalOpen } from "./share-modal.js";
import { getShareConfig, type ShareCapabilityConfig } from "./config.js";
import type { ShareApi } from "./types.js";

/** Read helpers added to the Share facade for integrators / no-code studio. */
export interface ShareReadApi {
    /** Returns `true` when share is enabled (`modules.permalink.share.enabled !== false`). */
    isEnabled(): boolean;
    /** Returns the resolved `modules.permalink.share` config (merged over the built-in defaults). */
    getConfig(): ShareCapabilityConfig;
}

/** The object mounted on `GeoLeaf.Share` — modal controls + read helpers. */
export type SharePublicApi = ShareApi & ShareReadApi;

/**
 * Public Share facade — bound to `GeoLeaf.Share`.
 */
export const Share: SharePublicApi = {
    /** Open the share modal (URL + on-demand QR). */
    openShareDialog(): void {
        openShareModal();
    },

    /** Close the share modal if open. */
    closeShareDialog(): void {
        closeShareModal();
    },

    /** Returns whether the share modal is currently open. */
    isOpen(): boolean {
        return isShareModalOpen();
    },

    /** Returns the current shareable URL (no DOM side-effect). */
    getShareUrl(): string {
        return buildShareUrl();
    },

    /** Returns `true` when share is enabled (`modules.permalink.share.enabled !== false`). */
    isEnabled(): boolean {
        return getShareConfig().enabled !== false;
    },

    /** Returns the resolved `modules.permalink.share` config (merged over the built-in defaults). */
    getConfig(): ShareCapabilityConfig {
        return getShareConfig();
    },
};
