/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Public barrel for the kernel event bus.
 *
 * This is the mediated entry point for the `capabilities/ → kernel/` boundary
 * (backlog R.8): a capability dispatches kernel events through here, never by
 * reaching into `./event-bus.js` directly.
 *
 * Named re-exports only — never `export *`, which would widen the surface every
 * time the implementation grows an export.
 */

export { dispatchGeoLeafEvent } from "./event-bus.js";
