/*!
 * GeoLeaf Core (share capability) — public types
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Public type surface for the in-core `share` capability.
 */

/** The runtime Share facade (bound to `GeoLeaf.Share`). */
export interface ShareApi {
    /** Open the share modal (URL + on-demand QR). */
    openShareDialog(): void;
    /** Close the share modal if open. */
    closeShareDialog(): void;
    /** Returns whether the share modal is currently open. */
    isOpen(): boolean;
    /** Returns the current shareable URL (no DOM side-effect). */
    getShareUrl(): string;
}
