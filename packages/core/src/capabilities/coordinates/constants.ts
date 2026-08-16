/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Coordinates capability — shared display defaults.
 *
 * The lat/lng decimal count lived as the bare literal `6` in three places that must agree:
 * the control's own `_options` (`coordinates.ts`), the config reader's `DEFAULTS`
 * (`config.ts`), and the introspection schema (`coordinates-capability.ts`). Centralising it
 * here keeps the advertised default and the applied default identical by construction.
 */

/** Default number of decimals shown for latitude / longitude in the readout. */
export const DEFAULT_COORDINATES_DECIMALS = 6;
