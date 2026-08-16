/*!
 * GeoLeaf Core - API (public facade)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
/**
 * @description ESM re-export of {@link GeoLeafAPI} — the live `globalThis.GeoLeaf` object.
 *
 * @remarks
 * ⚠️ This description listed the eleven top-level methods as things this module "groups" until
 * socle-init 7.7. It never mounted them: `globals/globals.api.ts` does, and since 7.7 it is the
 * only module that does. What travels through here is the namespace REFERENCE, and the methods
 * are on it whenever the `globals/` chain has run.
 *
 * @see {@link GeoLeafAPI}
 * @see globals/globals.api — `defineApiMethods`, the single writer of the eleven
 */

// Side-effect import: keeps `kernel/api/geoleaf-api.js` in the bundle, so its
// `_g.GeoLeaf = _g.GeoLeaf || {}` runs and the namespace object exists.
//
// ⚠️ This comment justified the import by « guarantees that `Object.assign(GeoLeaf, { loadConfig,
// init, ... })` inside geoleaf-api.js runs » until socle-init 7.7 removed that assignment. And a
// second thing measured at the same time: in the GRANULAR build, `dist/esm/api/geoleaf.api.js`
// **is not emitted at all** — Rollup flattens a module of pure re-exports under `preserveModules`
// (see `rollup.config.mjs`), and `dist/esm/kernel-exports.js` re-exports `GeoLeafAPI` straight
// from `kernel/api/geoleaf-api.js`. So the protection described here only ever operated in the
// single-file CDN bundle. Kept for that bundle; do not read it as covering the granular one.
import "../kernel/api/geoleaf-api.js";
export { GeoLeafAPI } from "../kernel/api/geoleaf-api.js";
