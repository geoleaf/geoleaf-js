/**
 * @file no-own-namespace.js
 * @description The plugins mounting NO namespace of their own — the list,
 * each one's motive, and the surface they DRIVE instead.
 *
 * ## Why this list lives here, and not in one of the two guards reading it
 *
 * The fact it states — "this plugin sets no facade" — belongs to neither.
 * `guards/plugin-namespace-declared.guard.test.js` draws from it a
 * **declaration exemption** in `GeoLeafGlobal`;
 * `guards/doc-plugin-manifest.guard.test.js` draws what the **spec sheet**
 * must write in its `namespace` line. Two copies would drift — and the day
 * one settled an entry, the other would keep exempting. The motive already
 * written for `KNOWN_DEFAULT_DRIFT`, which
 * `doc-capability-config.guard.test.js` **reads at its source** instead of
 * copying it.
 *
 * ⚠️ **This file is not a test suite.** `packages/core/vitest.config.ts`
 * only collects `.test.js` files: a helper under `__tests__/_helpers/` does
 * not become an empty test file there, it stays an importable module. Two
 * neighbours already follow this pattern (`load-wired-config.js`,
 * `dom-create-double.js`).
 *
 * ## What makes an entry FALSIFIABLE — and why `motif` was not enough
 *
 * Until 28/07/2026 this list only carried a `motif`, i.e. **prose nothing
 * read**. An entry was thus indistinguishable from a complacency exemption:
 * any plugin having *forgotten* its facade could be inscribed and silence
 * the guard.
 *
 * The two added fields close that hole, and they are not decorative — the
 * owning guard VERIFIES them:
 *
 *  - `drives` — the CORE surface the plugin drives instead of its own. The
 *    guard requires the `entry.ts` to really reach it. A plugin that simply
 *    forgot its facade drives **nothing**, hence cannot satisfy this assertion.
 *  - `owner` — the core file that SETS this surface. The guard requires it
 *    to exist. An exemption pointing at a vanished file still exempts, but
 *    no longer informs.
 *
 * Same pattern as `NO_CONFIG_ACCESSOR`
 * (`__tests__/capabilities/scaffold-taxonomy.test.js`) and
 * `NO_CAPABILITY_CONFIG` (`__tests__/guards/doc-capability-config.guard.test.js`).
 */
"use strict";

/** @type {Record<string, { motif: string, drives: string, owner: string }>} */
export const NO_OWN_NAMESPACE = {
    "offline-ui": {
        motif: "ne monte aucun namespace propre : il PILOTE `GeoLeaf.Storage`, une façade du CORE (capacité `offline`). Son `healthCheck` interroge donc volontairement une surface qu'il n'a pas posée, et son `entry.ts` l'écrit en toutes lettres",
        /** Core surface really driven — verified present in its `entry.ts`. */
        drives: "GeoLeaf.Storage",
        /** Who sets this surface — verified existing on disk. */
        owner: "packages/core/src/kernel/storage/facade.ts",
    },
};
