/*!
 * @geoleaf-plugins/cog — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 *
 * Façade only (INV-FACADE): pure re-export of the COG API. The implementation lives in
 * `cog-api.ts`. Mounted on `GeoLeaf.COG` by `entry.ts`.
 *
 * @example
 * const handle = await GeoLeaf.COG.addLayer(url, map, { opacity: 0.8 });
 * handle.remove();
 */

export { addLayer, removeLayer, getInfo } from "./cog-api.js";
