/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Public barrel for the kernel storage sub-system.
 *
 * Mediated entry point for the `capabilities/ → kernel/` boundary (backlog R.8).
 * Only the service-worker registration surface is consumed across that boundary
 * today (by `capabilities/pwa/`); the rest of the sub-system stays internal.
 */

export { SWRegister } from "./sw-register.js";
