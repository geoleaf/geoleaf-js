/*!
 * GeoLeaf — the PUBLISHED recipe, exercised.
 * © 2026 Mattieu Pottier — MIT
 */

/**
 *
 * @description
 * A custom entry in the same shape as `examples/minimal/entry.ts`, written the way a real
 * integrator must write it: through the **published npm subpaths** (`@geoleaf/core/kernel`,
 * `@geoleaf/core/capabilities/<id>/install.js`, …), not through relative `../../src/` paths
 * that only exist inside this repository.
 *
 * ⚠ This paragraph said « **the same nine capabilities** » as `minimal`, which embarks **six**.
 * The two lists differ on purpose — see §What this entry embarks below — and the count is
 * no longer written here: it is the `caps=` of the generated region, read by the guard.
 *
 * ## Why this file exists (S6)
 *
 * `examples/minimal/entry.ts` proves that the *source graph* tree-shakes. It cannot prove that
 * the *published package* does — and in S6 we found out the hard way that the two had diverged:
 *
 *   - the recipe documented in COOKBOOK.md pointed at `@geoleaf/core/src/…`, which `files`
 *     never publishes and `exports` never exposes: it could not have worked for anybody;
 *   - `dist/esm/` — the artifact `exports["."]` resolves to — was being built with a
 *     `moduleSideEffects` heuristic that dropped the three modules mutating the `Config`
 *     singleton, so `import { Config } from "@geoleaf/core"` shipped a `Config` with no `.get()`.
 *
 * Neither defect was visible from inside the repo. Both are visible from here. This entry is
 * bundled on every build and measured by `scripts/check-consumer-bundle.cjs`, which asserts that
 * the published package (a) resolves every subpath, (b) tree-shakes the capabilities this entry
 * does not list, and (c) keeps the side-effect modules that `package.json#sideEffects` promises
 * to keep.
 *
 * ## What this entry embarks, and why NOT the same thing as `minimal`
 *
 * 🛑 This section said "**Keep this list in lock-step with
 * `examples/minimal/entry.ts`** — the two entries embark the same capabilities
 * on purpose" until 2026-08-07, and the instruction was **stale by one day**.
 * Measured: it was written on **2026-07-14**, and the deliberate exclusion of
 * `cluster`, `toast-renderer` and `geolocation` in `minimal` was written on
 * **2026-07-15**, with its motive. Nobody removed the first.
 *
 * The two entries do **not prove the same thing**, so they do not embark the
 * same list:
 *
 *   - `minimal` **excludes** `cluster`, `toast-renderer` and `geolocation` —
 *     those three were pinned by a static import from eager kernel code, and
 *     their absence from the bundle is what proves the service locator really
 *     unbound them. That is the **exclusion** side, measured by `size:example`
 *     on the SOURCE graph.
 *   - `consumer` **includes** them — because what it proves is npm subpath
 *     resolution and the **published package's** `sideEffects`, which asks to
 *     traverse as many paths as possible, not as few.
 *
 * ⚠️ These two bullets carried a count — "`minimal` (6)" and "`consumer` (9)" —
 * until 2026-08-08, while the header asserts thirty lines higher that the count
 * is no longer written here but derived from the generated region's `caps=`.
 * The file contradicted itself. So: both numbers are REMOVED, not corrected —
 * the marker's `caps=` is the register.
 *
 * ⚠️ What was once believed a **drift** (6 versus 9) is thus a divergence
 * **wanted and documented on both sides**. What was missing was not list
 * equality — it was each entry being true by construction. That is what the
 * generated region below brings.
 *
 * ## The bounded region
 *
 * Everything after `@geoleaf:gen:start` is **generated** by
 * `scripts/gen-entry.cjs` from the marker's `caps=` list: const names, load
 * order (that of `FULL.capabilities`), import paths and re-exportable facades
 * derive from it. Do not edit it by hand — the
 * `__tests__/guards/generated-entries.guard.test.ts` guard regenerates and
 * compares.
 */
"use strict";

// @geoleaf:gen:start caps=taxonomy,feature-info,cluster,toast-renderer,legend,coordinates,scale,geolocation,permalink mode=npm id=consumer

// ── 1. Kernel side-effects — the two the shipped entry imports too ───────────
import "@geoleaf/core/globals";
import "@geoleaf/core/helpers";

// ── 2. The manifest — the capabilities THIS bundle embarks ───────────────────
import type { PresetManifest } from "@geoleaf/core/contracts/preset.contract.js";
import { COORDINATES_INSTALLER } from "@geoleaf/core/capabilities/coordinates/install.js";
import { SCALE_INSTALLER } from "@geoleaf/core/capabilities/scale/install.js";
import { GEOLOCATION_INSTALLER } from "@geoleaf/core/capabilities/geolocation/install.js";
import { TAXONOMY_INSTALLER } from "@geoleaf/core/capabilities/taxonomy/install.js";
import { FEATURE_INFO_INSTALLER } from "@geoleaf/core/capabilities/feature-info/install.js";
import { CLUSTER_INSTALLER } from "@geoleaf/core/capabilities/cluster/install.js";
import { TOAST_RENDERER_INSTALLER } from "@geoleaf/core/capabilities/toast-renderer/install.js";
import { LEGEND_INSTALLER } from "@geoleaf/core/capabilities/legend/install.js";
import { PERMALINK_INSTALLER } from "@geoleaf/core/capabilities/permalink/install.js";

const MANIFEST: PresetManifest = {
    id: "consumer",
    capabilities: [
        COORDINATES_INSTALLER,
        SCALE_INSTALLER,
        GEOLOCATION_INSTALLER,
        TAXONOMY_INSTALLER,
        FEATURE_INFO_INSTALLER,
        CLUSTER_INSTALLER,
        TOAST_RENDERER_INSTALLER,
        LEGEND_INSTALLER,
        PERMALINK_INSTALLER,
    ],
};

// ── 3. Install the boot, bound to this manifest ──────────────────────────────
import { installBoot } from "@geoleaf/core/boot";

installBoot(MANIFEST);

// ── 4. Surface ESM publique ──────────────────────────────────────────────────
export * from "@geoleaf/core/kernel";

export { Notifications } from "@geoleaf/core/capabilities/toast-renderer/public-api.js";
export { Legend } from "@geoleaf/core/facades/legend.js";
export { Permalink } from "@geoleaf/core/facades/permalink.js";
export { Share } from "@geoleaf/core/facades/share.js";

export default typeof window !== "undefined"
    ? (window as unknown as Record<string, unknown>)["GeoLeaf"]
    : {};

// @geoleaf:gen:end
