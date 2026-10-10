/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `legend` capability — presets build (S2).
 *
 * Single self-sufficient anchor: importing THIS file is the only thing a preset does
 * to embark Legend. First **multi-layer** installer of S2 — the capability's layer-B
 * writes were split across two files, and are reunited here:
 *   - `globals.ui.ts` (`setupUI`, B6) — `_LegendControl` / `_LegendGenerator` ;
 *   - `globals.api.ts` (`assignApiFacades`, B11) — `Legend` (the public facade).
 *
 * The mobile toolbar icon is carried by the MODULE (`LegendModule.ui.mobileIcon`),
 * not by the capability declaration — `createModule()` transports it as-is.
 *
 * ⚠ `LegendModule` here is the `ICoreModule` class from `./module.ts` — NOT the same-named
 * internal API object inside `./legend.ts` (re-exported by `./public-api.ts`). The two have
 * always been distinct; they are now at least neighbours rather than a cross-tree pair.
 */

// ── Stylesheet (S6) ─────────────────────────────────────────────────────────
// The capability owns its CSS and pulls it into the module graph from HERE — the one module
// a consumer must import to get this capability at all. Skip the installer and the stylesheet
// is never in the graph either: the CSS tree-shakes with the code.
import "./css/legend.css";

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { LEGEND_CAPABILITY } from "./legend-capability.js";
// The boot wrapper now lives INSIDE this capability — no app/ path,
// no exception, and the ICoreModule lifecycle is co-located with what it drives.
import { LegendModule } from "./module.js";
// Direct file imports (never through ./index.js — that barrel also re-exports
// BasemapSelector from the layer-manager, a parasitic cross-import).
import { LegendControl } from "./legend-control.js";
import { LegendGenerator } from "./legend-generator.js";
import { Legend } from "../../api/geoleaf.legend.js";
// The kernel's legend slot, filled here: the kernel keeps the legend in step with a layer's style
// and visibility through it, and no longer imports this capability (`kernel/shared/legend-slot.ts`).
import { LegendContract } from "./legend-seam.js";
import { provideLegend } from "../../kernel/shared/index.js";

/** Self-sufficient installer for the Legend capability (cartographic legend panel). */
export const LEGEND_INSTALLER: CapabilityInstaller = {
    declaration: LEGEND_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        // Layer B — moved verbatim from globals.ui.ts (setupUI, B6 legend block)…
        gl._LegendControl = LegendControl;
        gl._LegendGenerator = LegendGenerator;
        // `_LegendRenderer` was write-only (never read via the global — legend-control.ts
        // imports LegendRenderer statically) — removed.
        // …and from globals.api.ts (assignApiFacades, B11).
        gl.Legend = Legend;
        // Pass 1, before any module runs: the theme applier asks for the legend during the
        // registry's `init()`, and `LegendContract.isAvailable()` answers `false` until the
        // legend itself is initialised.
        provideLegend(LegendContract);
    },

    createModule() {
        return new LegendModule();
    },
};
