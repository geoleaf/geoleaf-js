/*!
 * @geoleaf-plugins/flatgeobuf — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 *
 * Façade only (INV-FACADE): pure re-export. The implementation lives in `fgb-api.ts`.
 * Mounted on `GeoLeaf.FlatGeobuf` by `entry.ts`.
 *
 * ⚠️ Corrected 27/07/2026: this header said `GeoLeaf.FGB`, a name that exists NOWHERE — not in
 * `entry.ts`, not in `global.d.ts` (which declares `FlatGeobuf`). Measured: the only two
 * occurrences in the repo were this line and the header of `fgb-api.ts`, i.e. two comments
 * pointing at each other. A reader following either one looked for an API that is not mounted.
 * https://geoleaf.dev
 */

export { load, loadBbox, loadAsLayer, loadBboxAsLayer } from "./fgb-api.js";
