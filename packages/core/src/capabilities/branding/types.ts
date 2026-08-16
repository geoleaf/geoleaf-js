/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Branding capability — local structural types.
 *
 * Relocated from `modules/built-in/ui/branding.ts` when the branding overlay was
 * reclassified to an in-core capability (`capabilities/branding/`, gate
 * `modules.branding.enabled`).
 */

import type { GeoLeafControl } from "../../contracts/map-adapter.contract.js";

/** Subset of the map adapter consumed by the branding control. */
export interface BrandingMapLike {
    addControl(control: HTMLElement, position: string): GeoLeafControl;
}

/** Branding control runtime options. */
export interface BrandingOptions {
    position: string;
    text: string;
}

/** Branding control instance (members accessed via `this`). */
export interface BrandingControl {
    _map: BrandingMapLike | null;
    _controlHandle: GeoLeafControl | null;
    _container: HTMLElement | null;
    _cleanups: Array<() => void>;
    _options: BrandingOptions;
    init(map: BrandingMapLike, options?: Partial<BrandingOptions>): void;
    _createControl(): void;
    destroy(): void;
    show(): void;
    hide(): void;
    setText(text: string): void;
}
