/*!
 * GeoLeaf Core — Example: a minimal custom bundle entry
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * **This file is the recipe.** GeoLeaf ships one bundle (`dist/geoleaf.esm.js`) containing
 * every in-core capability, because batteries-included is the right default. If you want a
 * lighter bundle, you do not fork the library and you do not learn a preset format — you
 * write an entry like this one, point your bundler at it, and the capabilities you left out
 * are tree-shaken away.
 *
 * An entry is exactly four things:
 *   1. the kernel side-effect chain (`globals` → `helpers`) ;
 *   2. a manifest — the list of capability installers you want ;
 *   3. `installBoot(manifest)` — kernel modules, registry, and the `GeoLeaf.boot()` facade ;
 *   4. the public ESM surface: the kernel re-exports, plus the facades of YOUR capabilities.
 *
 * ## Why this example is built on every `npm run build`
 *
 * It is not decoration: it is the **proof**. `npm run size:example` measures its real eager
 * boot closure and asserts that not one file of an excluded capability is in it. Without that,
 * "the core is tree-shakeable" would be an unverifiable claim that rots the first time someone
 * adds a static import from the kernel to a capability — which is precisely what had happened
 * (`shared.module` → pwa/offline) and what S4 fixed.
 *
 * Its output lives in `examples/dist/` — outside `dist/`, so it is never published to npm.
 *
 * ## Two rules, and they are the whole trick
 *
 * - **Never import a capability from kernel code.** A capability is embarked by its
 *   `install.ts` appearing in a manifest — nowhere else. `kernel-exports.ts` deliberately
 *   re-exports no capability facade for the same reason.
 * - **Order matters in the manifest.** `route` before `filter` (topo-sort tie-break).
 *   ⚠ This line also gave `pwa` before `offline` (« their app-global lifecycles run in list
 *   order, #7 → #8 ») until 08/08/2026. **Socle-init 7.4 measured that one false**: the pair
 *   inverts with no observable difference, because `offline` reads `modules.pwa.enabled` from
 *   the merged config bag rather than from anything `pwa` posts. See
 *   `__tests__/presets/shared-lifecycle-order.test.ts`.
 *   ⚠ This line also said « and the `mobileIcon` pills render in registry insertion order »
 *   until 07/08/2026. **It no longer does** (socle-init 7.5): `mobileIcon` carries an explicit
 *   `order`, so the toolbar layout stopped being an emergent property of a list ordered for
 *   three unrelated reasons. The two remaining reasons above are still load-bearing.
 *   ⚠ You do not hand-maintain that order here either — the generated region below derives it
 *   from `FULL.capabilities`.
 *
 * ## What this entry embarks
 *
 * Enough for a real map you can look at, click and share: layers with categorised, tinted
 * symbols (taxonomy), a legend, popups/tooltips (feature-info), the coordinate / scale map
 * controls, and a permalink (+ share). The embarked list itself is the `caps=` of the marker
 * below — written once, read by the generator and by the guard.
 *
 * **Left out:** `branding`, `cluster`, `filter`, `geolocation`, `labels`, `language-switcher`,
 * `offline`, `profile-switcher`, `pwa`, `route`, `theme-palette`, `theme-selector`,
 * `theme-toggle`, `toast-renderer`, `vector-tiles`. Not one line
 * of them reaches the bundle — that is what the gate checks. `vector-tiles` is the clearest
 * illustration of why build-time composition beats a runtime flag: a whole body of MVT machinery
 * that a consumer serving plain GeoJSON can never use, and that no config key could have
 * removed from the file. (⚠️ This sentence carried a line count — « 744 lines » — until
 * 08/08/2026. It had been true at the S5 relevé and was 217 lines off by then: socle B.1 moved
 * the MapLibre building out. Same doctrine — a number in prose next to code that owns it can only
 * drift, and the argument never needed it.) `cluster`, `toast-renderer` and `geolocation` (S7) prove the same
 * point on smaller edges: each used to be pinned by a single static import from kernel-eager
 * code (the GeoJSON loader, the `ui.notify` adapter, the mobile toolbar) — now resolved
 * lazily through the service locator, so leaving the installer out is enough.
 *
 * Note this is a *build-time* choice. Runtime config (`modules.<cap>.enabled`) still gates
 * what an embarked capability *does* — but it can never remove its code from the file. Only
 * leaving it out of the manifest does that.
 *
 * ## The bounded region
 *
 * Everything after `@geoleaf:gen:start` is **generated** by
 * `scripts/gen-entry.cjs` from the marker's `caps=` list: const names, load
 * order, import paths and re-exportable facades derive from it. Do not edit it
 * by hand — the `__tests__/guards/generated-entries.guard.test.ts` guard
 * regenerates and compares, and also verifies that the **Left out** list above
 * is exactly the complement of `caps=`.
 */
"use strict";

// @geoleaf:gen:start caps=taxonomy,feature-info,legend,coordinates,scale,permalink mode=relative id=minimal

// ── 1. Kernel side-effects — the two the shipped entry imports too ───────────
import "../../src/globals/globals.js";
import "../../src/app/app-namespace.js";

// ── 2. The manifest — the capabilities THIS bundle embarks ───────────────────
import type { PresetManifest } from "../../src/contracts/preset.contract.js";
import { COORDINATES_INSTALLER } from "../../src/capabilities/coordinates/install.js";
import { SCALE_INSTALLER } from "../../src/capabilities/scale/install.js";
import { TAXONOMY_INSTALLER } from "../../src/capabilities/taxonomy/install.js";
import { FEATURE_INFO_INSTALLER } from "../../src/capabilities/feature-info/install.js";
import { LEGEND_INSTALLER } from "../../src/capabilities/legend/install.js";
import { PERMALINK_INSTALLER } from "../../src/capabilities/permalink/install.js";

const MANIFEST: PresetManifest = {
    id: "minimal",
    capabilities: [
        COORDINATES_INSTALLER,
        SCALE_INSTALLER,
        TAXONOMY_INSTALLER,
        FEATURE_INFO_INSTALLER,
        LEGEND_INSTALLER,
        PERMALINK_INSTALLER,
    ],
};

// ── 3. Install the boot, bound to this manifest ──────────────────────────────
import { installBoot } from "../../src/app/boot-install.js";

installBoot(MANIFEST);

// ── 4. Surface ESM publique ──────────────────────────────────────────────────
export * from "../../src/kernel-exports.js";

export { Legend } from "../../src/api/geoleaf.legend.js";
export { Permalink } from "../../src/api/geoleaf.permalink.js";
export { Share } from "../../src/api/geoleaf.share.js";

export default typeof window !== "undefined"
    ? (window as unknown as Record<string, unknown>)["GeoLeaf"]
    : {};

// @geoleaf:gen:end
