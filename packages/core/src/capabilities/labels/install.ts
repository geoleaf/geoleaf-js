/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `labels` capability — presets build (S2).
 *
 * Single self-sufficient anchor: importing THIS file is the only thing a preset
 * does to embark Labels. It regroups the 3 static-anchoring layers behind one
 * import site (see {@link module:contracts/preset.contract}):
 *   - **C** — {@link declaration} (register + gate) + {@link createModule} ;
 *   - **B** — {@link registerGlobals} (the `window.GeoLeaf.*` writes moved out of
 *     `globals.ui.ts`'s `setupUI`, B6 labels block) ;
 *   - **A** — the façade module (`geoleaf.labels`) pulled into the static closure
 *     by the import below.
 */
"use strict";

// ── Stylesheet (S6) ─────────────────────────────────────────────────────────
// The capability owns its CSS and pulls it into the module graph from HERE — the one module
// a consumer must import to get this capability at all. Skip the installer and the stylesheet
// is never in the graph either: the CSS tree-shakes with the code.
import "./css/labels.css";

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { LABELS_CAPABILITY } from "./labels-capability.js";
// The boot wrapper now lives INSIDE this capability (backlog R.10) — no app/ path,
// no exception, and the ICoreModule lifecycle is co-located with what it drives.
import { LabelsModule } from "./module.js";
import { LabelButtonManager } from "./label-button-manager.js";
import { LabelRenderer } from "./label-renderer.js";
import { Labels } from "../../api/geoleaf.labels.js";

/** Self-sufficient installer for the Labels capability (per-layer text labels). */
export const LABELS_INSTALLER: CapabilityInstaller = {
    declaration: LABELS_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        // Layer B — moved verbatim from globals.ui.ts (setupUI, B6 labels block).
        gl._LabelButtonManager = LabelButtonManager;
        gl._LabelRenderer = LabelRenderer;
        gl.Labels = Labels;
    },

    createModule() {
        return new LabelsModule();
    },
};
