/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Branding capability — lifecycle / mount wiring.
 *
 * Wires the `Branding` overlay init/destroy. Invoked by `BrandingModule`
 * (registered in `boot.ts` only when `modules.branding.enabled` is truthy),
 * replacing the former #21 call in `ui.module.ts`. The map adapter is the
 * boot-created `MaplibreAdapter` forwarded through `ICoreModule.init(adapter)`.
 */
"use strict";

import { Branding } from "./branding.js";
import type { BrandingMapLike } from "./types.js";

let _started = false;

/** Idempotent mount for the Branding capability. Safe to call multiple times. */
export const BrandingLifecycle = {
    init(map: BrandingMapLike): void {
        if (_started) return;
        _started = true;
        Branding.init(map);
    },

    /** Tears down the overlay (module destroy / test seam). */
    _reset(): void {
        Branding.destroy();
        _started = false;
    },
};
