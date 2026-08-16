/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `permalink` capability — presets build (S2 Lot 6).
 *
 * Single self-sufficient anchor for permalink **and its `share` sub-feature** (S13 F7:
 * share is deliberately not a capability of its own — it is declared under
 * `PERMALINK_CAPABILITY.configSchema.share`).
 *
 * Two peculiarities, both expressed as contract FIELDS rather than code paths:
 *   - **Permalink owns no `ICoreModule`.** It is driven by two boot hooks that stay
 *     exactly where they are: `core-map.module` (read the URL state before the map is
 *     created) and `init-reveal` (apply + start sync after reveal). Both read
 *     `GeoLeaf.Permalink` off the namespace and enforce the gate on the merged config —
 *     so they are indifferent to WHERE the facade is assigned. The `createModule` below
 *     is therefore **share's** module, not permalink's.
 *   - **Share's gate differs from permalink's** (`modules.permalink.share.enabled`, an
 *     opt-out sub-key) → {@link CapabilityInstaller.moduleGate}. A profile that disables
 *     permalink keeps its share module, exactly as the legacy boot block did.
 *
 * `ShareLifecycle.init()` is NOT called here: an installer assigns, it does not behave.
 * It is called by `ShareModule.init()` — and only there since S2 Lot 6 (the eager call in
 * `setupUI` is gone, which removes the last static kernel → share import).
 */

// ── Stylesheet (S6) ─────────────────────────────────────────────────────────
// The capability owns its CSS and pulls it into the module graph from HERE — the one module
// a consumer must import to get this capability at all. Skip the installer and the stylesheet
// is never in the graph either: the CSS tree-shakes with the code.
import "./css/share.css";

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { PERMALINK_CAPABILITY } from "./permalink-capability.js";
// The boot wrapper now lives INSIDE this capability (backlog R.10) — no app/ path,
// no exception, and the ICoreModule lifecycle is co-located with what it drives.
import { ShareModule } from "./share/module.js";
import { Permalink } from "../../api/geoleaf.permalink.js";
import { Share } from "../../api/geoleaf.share.js";

/** Self-sufficient installer for the Permalink capability (URL state + share sub-feature). */
export const PERMALINK_INSTALLER: CapabilityInstaller = {
    declaration: PERMALINK_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        // Layer B — moved verbatim from globals.api.ts (assignApiFacades, B11)…
        gl.Permalink = Permalink;
        // …and from globals.ui.ts (setupUI, B9 share block).
        gl.Share = Share;
    },

    createModule() {
        return new ShareModule();
    },

    // Share is a sub-feature: its module hangs off `modules.permalink.share.enabled`
    // (opt-out), NOT off the capability's own `modules.permalink.enabled` gate.
    moduleGate: { configPath: "modules.permalink.share.enabled", enableWhenAbsent: true },
};
