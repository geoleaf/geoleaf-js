/*!
 * GeoLeaf Core — Example: a composed entry with a reduced capability list
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * **A second recipe, and the point of having two.** `examples/minimal/` shows the smallest
 * credible bundle — six capabilities, chosen to make the tree-shaking proof unambiguous. This
 * one shows the other question an integrator actually asks: *given a written list of the APIs
 * my application calls, which capabilities must I embark?*
 *
 * ## How this list was derived — and it was derived, not chosen
 *
 * Every capability below is here because something **written and verifiable** demands it. The
 * derivation is recorded, capability by capability, in the project's instruction notes; the
 * short form is:
 *
 * - `feature-info`, `labels`, `legend`, `theme-selector` — their members appear in a
 *   consumption contract as required public API.
 * - `filter` — a DOM selector it owns (`#gl-filter-panel`) is a contractual anchor.
 * - `taxonomy` — a withdrawn path names it as the migration target.
 * - `offline` — `GeoLeaf.Storage` is mounted by the kernel, but its ENGINE is this capability.
 *   Leaving it out yields a `Storage` surface with nothing behind it, and no error.
 * - `pwa` — a hard dependency of `offline`; the generator refuses the list without it.
 * - `toast-renderer` — opt-out, and `ui.notify.*` reads it optionally: every call becomes a
 *   silent no-op, including failure reports.
 * - `cluster` — absent, it is read as `enabled: false` with no message.
 *
 * 🛑 **The last three are the interesting ones.** Nothing in any contract asks for them. They
 * are here because their ABSENCE degrades in silence — and a bundle that degrades in silence
 * is the defect this whole line of work exists to remove. The rule is therefore: leave out
 * only what produces a VISIBLE error when missing.
 *
 * **Left out:** `branding`, `coordinates`, `geolocation`, `language-switcher`, `permalink`,
 * `profile-switcher`, `route`, `scale`, `theme-palette`, `theme-toggle`,
 * `vector-tiles`. Not one line
 * of them reaches the bundle — that is what the gate checks. `route` is the honest
 * edge of this exercise: it mounts no namespace symbol at all, so no contract could ever have
 * named it. It is left out because nothing in the repo activates it, which is a property of
 * the repo — not evidence about anyone's usage.
 *
 * ## What this file is NOT
 *
 * It is not a supported bundle and it is not published: `examples/` is outside `dist/` and
 * outside `files[]`, so it never reaches npm and nothing loads it at runtime. Its only
 * consumers are the build and the gate. An integrator copies it; they do not import it.
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

// @geoleaf:gen:start caps=taxonomy,feature-info,legend,labels,filter,theme-selector,cluster,toast-renderer,pwa,offline mode=relative id=slim

// ── 1. Kernel side-effects — the two the shipped entry imports too ───────────
import "../../src/globals/globals.js";
import "../../src/app/app-namespace.js";

// ── 2. The manifest — the capabilities THIS bundle embarks ───────────────────
import type { PresetManifest } from "../../src/contracts/preset.contract.js";
import { LABELS_INSTALLER } from "../../src/capabilities/labels/install.js";
import { TAXONOMY_INSTALLER } from "../../src/capabilities/taxonomy/install.js";
import { FEATURE_INFO_INSTALLER } from "../../src/capabilities/feature-info/install.js";
import { CLUSTER_INSTALLER } from "../../src/capabilities/cluster/install.js";
import { TOAST_RENDERER_INSTALLER } from "../../src/capabilities/toast-renderer/install.js";
import { LEGEND_INSTALLER } from "../../src/capabilities/legend/install.js";
import { FILTER_INSTALLER } from "../../src/capabilities/filter/install.js";
import { PWA_INSTALLER } from "../../src/capabilities/pwa/install.js";
import { OFFLINE_INSTALLER } from "../../src/capabilities/offline/install.js";
import { THEME_SELECTOR_INSTALLER } from "../../src/capabilities/theme-selector/install.js";

const MANIFEST: PresetManifest = {
    id: "slim",
    capabilities: [
        LABELS_INSTALLER,
        TAXONOMY_INSTALLER,
        FEATURE_INFO_INSTALLER,
        CLUSTER_INSTALLER,
        TOAST_RENDERER_INSTALLER,
        LEGEND_INSTALLER,
        FILTER_INSTALLER,
        PWA_INSTALLER,
        OFFLINE_INSTALLER,
        THEME_SELECTOR_INSTALLER,
    ],
};

// ── 3. Install the boot, bound to this manifest ──────────────────────────────
import { installBoot } from "../../src/app/boot-install.js";

installBoot(MANIFEST);

// ── 4. Surface ESM publique ──────────────────────────────────────────────────
export * from "../../src/kernel-exports.js";

export { Notifications } from "../../src/capabilities/toast-renderer/public-api.js";
export { Legend } from "../../src/api/geoleaf.legend.js";
export { PWA } from "../../src/api/geoleaf.pwa.js";

export default typeof window !== "undefined"
    ? (window as unknown as Record<string, unknown>)["GeoLeaf"]
    : {};

// @geoleaf:gen:end
