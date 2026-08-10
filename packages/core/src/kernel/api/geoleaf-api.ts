/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf — the public namespace, re-exported under its ESM name.
 *
 * ## What this module STOPPED doing, at socle-init 7.7
 *
 * It used to build the public API here: a `_getAPIController()` with validation, three delegating
 * wrappers, and an `Object.assign(existing, { … })` that wrote **the eleven** top-level methods of
 * {@link GeoLeafTopLevelApi} onto the namespace — the same eleven that `globals/globals.api.ts`
 * already wrote through `defineApiMethods()`.
 *
 * 🛑 **That duplicate was not inert, and no gate could see it**: gates compare NAMES, and both
 * spellings had the name. It won by evaluation order (this module is imported after the `globals/`
 * chain), and the two forms were not equivalent. It cost two production defects:
 *
 *   - `get BaseLayers()` declared inside the assigned literal wrote `undefined` over a correct
 *     alias — `Object.assign` reads own properties of the SOURCE, so it INVOKES the getter, with
 *     `this` bound to the literal, which did not declare `Baselayers` ;
 *   - `getMetrics() { return this.getHealth(); }` worked attached and threw detached.
 *
 * **The single writer is now `globals/globals.api.ts`**, and it carries the validated accessor
 * that used to live here (`requireController()` — read its note, it is what keeps a failed boot
 * from hanging in silence). The guard is
 * `__tests__/guards/top-level-api-single-writer.guard.test.ts`, written BEFORE the removal so it
 * could be seen red on intact production code, and seen red again by restoring the assignment.
 *
 * ## What it still does, and why it is not empty
 *
 * `GeoLeafAPI` **is** `globalThis.GeoLeaf` — the same object reference, not a copy. Every module
 * that mounts something onto the namespace mounts it here too, whenever it runs. So this export is
 * a live view, not a snapshot, and the `_g.GeoLeaf = _g.GeoLeaf || {}` below is what guarantees
 * the object exists at all for whoever imports `@geoleaf/core/kernel` first.
 *
 * ⚠️ **The namespace is POPULATED by `@geoleaf/core/globals`, not by this subpath.** Importing
 * `@geoleaf/core/kernel` alone gives you the namespace object without the eleven methods, because
 * nothing has called `setupAPIKernel()`. That is the published contract — every recipe in
 * `docs/COOKBOOK.md`, `docs/ARCHITECTURE_GUIDE.md` and `examples/consumer/entry.ts` opens with
 * `import "@geoleaf/core/globals";`, and the last of those is GENERATED, so it is true by
 * construction for any entry the repo produces. Before 7.7 this subpath happened to also populate
 * the namespace, as a side effect of the duplicate. Do not rely on that having been the contract.
 *
 * @see globals/globals.api — `defineApiMethods`, the single writer
 * @see contracts/top-level-api.contract — the eleven, and what each of them owes
 */
"use strict";

import { Log } from "../../utils/log/index.js";
import type { GeoLeafApiNamespace } from "./api-types.ts";

const _g = (
    typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : {}
) as { GeoLeaf?: GeoLeafApiNamespace };
_g.GeoLeaf = _g.GeoLeaf || {};

// Retrieve any GeoLeaf already attached by the modules
const existing: GeoLeafApiNamespace = _g.GeoLeaf || {};

/**
 * The public GeoLeaf namespace — the live global object, not a copy of it.
 *
 * Identity holds: no module of this package ever REPLACES `globalThis.GeoLeaf`, they all create it
 * with `|| {}` / `?? {}` and mutate it. So whatever is mounted later — by `globals/`, by a
 * capability installer, by a plugin — is visible through this binding without it being reassigned.
 */
const GeoLeafAPI = existing;

if (Log) {
    Log.info(`[GeoLeaf.API] Public API namespace exported`);
    // NOTE (S6 Lot 3) — do NOT read `existing._APIController` here.
    //
    // This block used to log the controller's health at module eval. `_APIController` is an
    // ACCESSOR (`controller.ts`), so merely READING it built and initialised the whole API
    // assembly at bundle-import time. That made a debug log load-bearing — and it is what
    // killed S4 (`192c6865`): once the setups no longer ran top-level, this line built the
    // controller with 0 managers, the boot died, and the sprint was reverted two hours later.
    //
    // Health is still reachable on demand — `GeoLeaf.getHealth()` returns it, lazily, when
    // someone actually asks. The controller is now built on first REAL use (the `loadConfig()`
    // in `boot-core.ts`), by which point phase A has posted every facade it needs.
}

export { GeoLeafAPI };
