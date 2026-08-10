/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Public facade for the Helpers module.
 * Provides DOM lookup utilities (`getElementById`, `querySelector`,
 * `querySelectorAll`), class manipulation and frame scheduling.
 *
 * @see {@link ./utils/general/helpers.ts} for the DOM helpers implementation
 * @see {@link ./utils/general/dom-helpers.ts} for element creation (`domCreate`)
 *
 * @example
 * ```ts
 * const el = GeoLeaf.Helpers.querySelector(".popup");
 * ```
 *
 * @remarks
 * `Helpers.createElement` was removed at KERNEL S10 (breaking, pre-v3
 * publication): it had no callers and its option shape diverged from the
 * canonical factory. Create elements with `domCreate` from
 * `utils/general/dom-helpers.ts`.
 */

export { Helpers } from "../utils/general/helpers-namespace.js";
