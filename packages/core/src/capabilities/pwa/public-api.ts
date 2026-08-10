/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

"use strict";

/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * PWA — public surface of the capability (`GeoLeaf.PWA`).
 *
 *
 * ARCHI S12.2 — the only real scaffold gap actually found across the 19 capabilities.
 * `pwa` exposed a public facade (`modules/geoleaf.pwa.ts`) that imported `pwa-manager.js`
 * directly, without going through a declared surface: the facade therefore published an
 * internal module, and nothing marked where the contract ended.
 *
 * ⚠️ The 4 other capabilities without a `public-api.ts` — `offline`, `route`,
 * `theme-selector`, `vector-tiles` — do NOT need one and will not get one: they expose no
 * facade, hence no public surface. Creating one (empty, or re-exporting internals) would
 * invent a contract that does not exist. The scaffold was not "incomplete at 5": it was
 * complete at 13, mis-named at 1 (`legend`, fixed in S12.1) and moot for 4.
 */

/**
 * The surface declares EXACTLY what the facade publishes — nothing more.
 *
 * An earlier version added a `buildPwaPublicApi()` and a `PWAPublicApi` type, mimicking
 * the neighbouring `scale/public-api.ts`. The `check-orphan-exports` gate flagged them as
 * having no consumer, and it was right: `pwa` assembles nothing, its manager already
 * carries the contract. Copying the shape of a neighbour that does have something to
 * assemble is exactly the cargo-cult this file says to avoid for the 4 surfaceless
 * capabilities.
 */
export { PWAManager as PWA } from "./pwa-manager.js";
export type { PWAConfig, InstallPromptConfig } from "./pwa-manager.js";
