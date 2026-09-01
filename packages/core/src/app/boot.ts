/*!
 * GeoLeaf Core – App / Boot
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Application Boot — the SHIPPED bundle (every in-core capability of the full preset).
 *
 * ⚠️ The count is deliberately NOT written here. This header once said « 17 » while the manifest said
 * « 18 » and the truth was 21 — two headers, two wrong numbers, neither load-bearing. The
 * registry is `presets/manifest.full.ts`; count it there if you need the figure.
 *
 * This file is now a **binding, not a boot**. Everything it used to do at module-eval —
 * the `?perf=1` latch, the 6 kernel module registrations, the `GeoLeaf._registry` anchors,
 * the `GeoLeaf.boot()` facade — moved to `boot-install.ts#installBoot(preset)` (S4), and the
 * boot *sequence* moved to `boot-core.ts#bootWithPreset()` (S3). What remains here is the one
 * thing specific to this bundle: **which capabilities it embarks**.
 *
 * That is the whole point of the split. Every entry needs the same module-eval, each with its
 * own manifest; duplicating it per entry is exactly the `boot-lite.ts` debt this chantier
 * removed. A consumer who wants fewer capabilities does not fork this file — they write their
 * own 25-line entry calling `installBoot()` with their own manifest, and the capabilities they
 * left out tree-shake away. See `examples/minimal/entry.ts`.
 *
 * Usage : <script>GeoLeaf.boot();</script>
 */
import { installBoot } from "./boot-install.js";
import { FULL } from "../presets/manifest.full.js";

const { app: _app } = installBoot(FULL);

export { _app };
