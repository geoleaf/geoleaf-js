/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Runtime manifest of the **shipped bundle** — every in-core capability, in load order.
 *
 * ⚠️ The count is deliberately NOT written here: this file IS the registry, so any
 * number in its own header is a second source of truth that can only drift from the array
 * below. It said « 18 » for 21 entries.
 *
 * The ordered list of capability installers `dist/geoleaf.esm.js` composes on top of the
 * the fixed kernel (**6 modules** registered by `app/boot-install.ts`: `core-map`, `config`,
 * `shared`, `geojson`, `ui`, `theme-engine` — this block used to say "8", counting
 * `api` and `security`, which are facade-only subsystems and not registry modules).
 * `bootWithPreset()` iterates it in a single 2-pass loop (declarations,
 * then gated modules), and `SharedModule` walks it for the app-global lifecycles.
 *
 * **This is the only manifest GeoLeaf ships, and it embarks everything** — the library is
 * batteries-included by default. It is not a "preset" in the sense of a menu: there is no
 * preset registry and no other manifest on npm. A consumer who wants a lighter bundle writes
 * their own entry with their own list (see `examples/minimal/entry.ts`) and lets the
 * capabilities they left out tree-shake away.
 *
 * ⚠ **ORDER IS LOAD-BEARING** in the following ways — do not reshuffle casually:
 *   - `route` before `filter` — Kahn's topo-sort tie-breaks on registration order (both
 *     depend on `geojson`), so this keeps the module init order stable ;
 *   - `theme-selector` last — same Kahn tie-break (deps `["geojson"]`, like legend and
 *     filter), which keeps the `geoleaf:app:ready` listener order stable.
 *
 * ⚠️ The count is gone from that line too (same reason as the header above): the list IS
 * the registry, and « three distinct ways » was a second copy of it that had already drifted
 * once — see the two notes below. Writing « two » would reproduce the defect one notch along.
 *
 * ⚠️ **A FOURTH reason was listed here until socle-init 9.0, and it had ceased to be true.**
 * It read « `permalink` last, `theme-selector` last — the mobile toolbar renders its pills in
 * registry insertion order ». Socle-init **7.5** replaced that emergent coupling with an
 * explicit `mobileIcon.order` (`legend` 10, `share` 20) and a stable sort in
 * `kernel/ui/mobile/mobile-toolbar-pill.ts` — so the toolbar no longer reads this file's
 * order at all, and `permalink`'s position is now free. The sentence also gave the toolbar as
 * `theme-selector`'s reason, which was never its reason: that one is the topo-sort tie-break
 * above. Three claimed constraints, two real ones, and one of the two misattributed.
 *
 * The lesson is the one no tooling can carry: no gate can check whether a sentence is still
 * TRUE. 7.5 changed the mechanism and left the sentence that described the old one — which is
 * exactly how a comment starts arguing against the code it sits on.
 *
 * ⚠️ **AND A SECOND REASON LEFT ON 08/08/2026 — this one was never true, not merely stale.**
 * It read « `pwa` before `offline` — their `sharedLifecycle`s run in this order (#7 → #8), and
 * offline reads `modules.pwa.enabled` ». Both clauses are facts; the conclusion is not. Socle-init
 * **7.4** measured it: `__tests__/presets/shared-lifecycle-order.test.ts` inverts the pair and
 * gets an IDENTICAL set of effects in all four `{pwa} × {offline}` config cells, and the same
 * under seeded permutations of every `sharedLifecycle` contributor.
 *
 * The position is free because `offline` reads that flag from the **merged config bag**
 * `SharedModule` hands every contributor — not from a state `pwa` posts. And the only thing `pwa`
 * would produce first, the service-worker registration, is deferred by `Helpers.lazyExecute`
 * (3 s ceiling), so it has not happened when #8 runs even in the nominal order. What holds the
 * dependency is the GATE in `offline/lifecycle.ts` — a condition, not a rank.
 *
 * 🛑 **And this file already contradicted itself, 90 lines apart.** The « S2 Batch 7 » comment
 * above `PWA_INSTALLER` has said « Position is free (no module, no mobileIcon) » the whole time.
 * Two statements about the same pair, opposite verdicts, same file — and the header was the one
 * being quoted, into eight other files.
 */

import type { PresetManifest } from "../contracts/preset.contract.js";
import { LABELS_INSTALLER } from "../capabilities/labels/install.js";
import { BRANDING_INSTALLER } from "../capabilities/branding/install.js";
import { COORDINATES_INSTALLER } from "../capabilities/coordinates/install.js";
import { THEME_TOGGLE_INSTALLER } from "../capabilities/theme-toggle/install.js";
import { SCALE_INSTALLER } from "../capabilities/scale/install.js";
import { GEOLOCATION_INSTALLER } from "../capabilities/geolocation/install.js";
import { TAXONOMY_INSTALLER } from "../capabilities/taxonomy/install.js";
import { FEATURE_INFO_INSTALLER } from "../capabilities/feature-info/install.js";
import { CLUSTER_INSTALLER } from "../capabilities/cluster/install.js";
import { TOAST_RENDERER_INSTALLER } from "../capabilities/toast-renderer/install.js";
import { LEGEND_INSTALLER } from "../capabilities/legend/install.js";
import { ROUTE_INSTALLER } from "../capabilities/route/install.js";
import { FILTER_INSTALLER } from "../capabilities/filter/install.js";
import { PERMALINK_INSTALLER } from "../capabilities/permalink/install.js";
import { PWA_INSTALLER } from "../capabilities/pwa/install.js";
import { OFFLINE_INSTALLER } from "../capabilities/offline/install.js";
import { THEME_SELECTOR_INSTALLER } from "../capabilities/theme-selector/install.js";
import { VECTOR_TILES_INSTALLER } from "../capabilities/vector-tiles/install.js";
import { PROFILE_SWITCHER_INSTALLER } from "../capabilities/profile-switcher/install.js";
import { LANGUAGE_SWITCHER_INSTALLER } from "../capabilities/language-switcher/install.js";
import { THEME_PALETTE_INSTALLER } from "../capabilities/theme-palette/install.js";

/** The shipped bundle's manifest — every in-core capability. */
export const FULL: PresetManifest = {
    id: "full",
    capabilities: [
        // ── Batch 1 ──
        LABELS_INSTALLER,
        // ── Batch 2 (simple UI controls: 5 map controls) ──
        BRANDING_INSTALLER,
        COORDINATES_INSTALLER,
        THEME_TOGGLE_INSTALLER,
        SCALE_INSTALLER,
        GEOLOCATION_INSTALLER,
        // ── Batch 3 (simple API capabilities) — order mirrors the historical boot declaration
        // block (taxonomy → feature-info → cluster), so introspection insertion-order
        // is byte-identical. `cluster` carries no createModule (policy capability).
        TAXONOMY_INSTALLER,
        FEATURE_INFO_INSTALLER,
        CLUSTER_INSTALLER,
        // ── Batch 4 (multi-layer) — toast-renderer BEFORE legend: mirrors the legacy
        // relative order of both their declarations and their gated modules. Note the
        // migrated pair now precedes the still-legacy filter / theme-selector / route
        // (Pass 1 runs before the legacy block) — no test or runtime consumer depends
        // on that global order. (The clause that used to close this sentence — « only
        // legend + share declare a mobileIcon, and share stays registered last » — was
        // retired by socle-init 7.5: pill order is now an explicit `mobileIcon.order`,
        // not a consequence of this list. See the ⚠️ note in the file header.)
        TOAST_RENDERER_INSTALLER,
        LEGEND_INSTALLER,
        // ── Batch 5 — route BEFORE filter: the legacy boot registered the route module
        // first (boot.ts gate block), and the Kahn topo-sort tie-breaks on registration
        // order (both depend on `geojson`) → keeping this order keeps the init order
        // byte-identical. (ROUTE_INSTALLER used to also contribute `filterRouteList` to a
        // filter seam at import time; that seam left with `GeoLeaf.Filters`.)
        ROUTE_INSTALLER,
        FILTER_INSTALLER,
        // ── Batch 6 — permalink here: it carries share's module, and the legacy boot
        // registered ShareModule last.
        // ⚠️ Its position is NO LONGER load-bearing. The reason written here was « the mobile
        // toolbar renders its pills in ModuleRegistry insertion order […] → keeping share last
        // keeps the pill order (legend then share) », and socle-init 7.5 retired it: `legend`
        // and `share` now carry an explicit `mobileIcon.order` (10, 20) that a stable sort in
        // `mobile-toolbar-pill.ts` reads instead. Kept where it is because moving it buys
        // nothing, not because moving it would break the toolbar.
        PERMALINK_INSTALLER,
        // ── Batch 7 — app-global capabilities with no ICoreModule: their lifecycles are
        // driven by `shared.module` (#7 pwa → #8 offline), untouched. Position is free
        // (no module, no mobileIcon). OFFLINE_INSTALLER also carries the static edge to
        // `geoleaf.sync.ts`, whose import-time self-mount `GeoLeaf.Sync` must stay in the
        // closure (data plugins register their sync handler before boot completes).
        PWA_INSTALLER,
        OFFLINE_INSTALLER,
        // ── Batch 8 (closing batch) — theme-selector LAST: the legacy boot registered its
        // declaration and its module after every other one, and the Kahn topo-sort
        // tie-breaks on registration order (deps ["geojson"], like legend and filter) →
        // keeping it last keeps the `geoleaf:app:ready` listener order byte-identical.
        THEME_SELECTOR_INSTALLER,
        // ── vector-tiles, appended AFTER theme-selector on purpose. It owns no module
        // and no mobileIcon, so its position is free for both the topo-sort and the toolbar;
        // appending keeps every other capability's registration index unchanged (introspection
        // insertion order is observable). Policy capability, like `cluster`: the GeoJSON loader
        // pulls it through the service locator, and falls back to plain GeoJSON without it.
        VECTOR_TILES_INSTALLER,
        // ── UI selectors — profile-switcher, appended LAST for the same reason
        // vector-tiles was: it declares no mobileIcon, and its module only subscribes to
        // the layer-manager panel seam (deps ["geojson"], like legend and filter), so its
        // position is free for both the topo-sort and the toolbar. Appending keeps every
        // other capability's registration index unchanged — introspection insertion order
        // is observable, and the golden-master asserts on it.
        PROFILE_SWITCHER_INSTALLER,
        // ── UI selectors — language-switcher, appended after profile-switcher for the
        // same reason: no mobileIcon, module deps ["geojson"], so its position is free and
        // appending leaves every prior registration index untouched.
        LANGUAGE_SWITCHER_INSTALLER,
        // ── UI selectors — theme-palette, appended last. Same reason: no mobileIcon,
        // module deps ["geojson"], so its position is free and no prior registration
        // index moves.
        THEME_PALETTE_INSTALLER,
    ],
};
