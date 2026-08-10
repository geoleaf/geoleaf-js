/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Branding capability — shared overlay defaults.
 *
 * Before this module the overlay position lived as a bare `"bottomleft"` literal in THREE
 * places that nothing held together: the introspection schema (`branding-capability.ts:48`)
 * advertised it, the config reader (`config.ts:47`) did NOT materialise it, and the value
 * actually applied came from a third copy in the control itself (`branding.ts:35`, the
 * `_options` seed). A profile author reading `getCapabilitySchema('branding')` was told a
 * default that no accessor rendered, and editing either literal left the other two lying.
 *
 * Centralising here — imported by the declaration (advertised value), the reader (applied
 * value) and the control (its `_options` seed) — makes the three the same *by construction*
 * (roadmap_optimisation-capacites B.24). Mirrors the `cluster/constants.ts` pattern.
 */
"use strict";

// Type-only (erased at compile): no runtime edge back to the reader that imports us.
import type { BrandingCapabilityConfig } from "./config.js";

/**
 * Default overlay position on the map, in the adapter's control-position vocabulary.
 * Handed to `IMapAdapter.addControl` by `Branding._createControl`.
 */
export const DEFAULT_BRANDING_POSITION = "bottomleft";

/**
 * The complete built-in `modules.branding` default set — the ONE source
 * `BRANDING_CAPABILITY.configSchema` advertises and `getBrandingConfig()` merges a profile
 * block over. A factory rather than a shared const, so no caller can mutate the next
 * caller's defaults.
 *
 * `enabled: false` — branding is opt-in (`enableWhenAbsent` omitted on the gate): the
 * overlay is inert unless a profile asks for it.
 */
export function brandingConfigDefaults(): BrandingCapabilityConfig {
    return { enabled: false, position: DEFAULT_BRANDING_POSITION };
}
