/*!
 * @geoleaf-plugins/file-import — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 *
 * Façade only (INV-FACADE): pure re-export. The implementation lives in `import-api.ts`.
 * Mounted on `GeoLeaf.FileImport` by `entry.ts`.
 * https://geoleaf.dev
 */

export { convert, importAsLayer, getSupportedFormats, registerConverter } from "./import-api.js";
export type { ImportLayerOptions } from "./import-api.js";
