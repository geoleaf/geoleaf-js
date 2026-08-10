/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `toast-renderer` capability — presets build (S2).
 *
 * Single self-sufficient anchor: importing THIS file is the only thing a preset does to
 * embark the toast renderer. Carries the 3 layer-B writes moved out of `globals.ui.ts`
 * (`setupUI`, B9): `_UINotifications` (the renderer singleton), `NotificationSystem`
 * (its class) and `Notifications` (the rich public facade).
 *
 * **`GeoLeaf.UI.notify` stays in the kernel** (`globals.ui.ts`): it is the rich
 * `notify()` adapter (anchor B2, called by third-party plugins before `boot()`). Since
 * S7 it no longer imports the singleton — it reads `_gl._UINotifications` back lazily
 * (same service-locator template as `vector-tiles`, S5), so leaving this capability out
 * of a preset now genuinely tree-shakes `notifications.ts`.
 */
"use strict";

// ── Stylesheet (S6) ─────────────────────────────────────────────────────────
// The capability owns its CSS and pulls it into the module graph from HERE — the one module
// a consumer must import to get this capability at all. Skip the installer and the stylesheet
// is never in the graph either: the CSS tree-shakes with the code.
import "./css/toast-renderer.css";

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { TOAST_RENDERER_CAPABILITY } from "./toast-renderer-capability.js";
// The boot wrapper now lives INSIDE this capability (backlog R.10) — no app/ path,
// no exception, and the ICoreModule lifecycle is co-located with what it drives.
import { ToastRendererModule } from "./module.js";
import { NotificationSystem, _UINotifications } from "./notifications.js";
import { Notifications } from "./public-api.js";

/** Self-sufficient installer for the Toast-Renderer capability (DOM notifications). */
export const TOAST_RENDERER_INSTALLER: CapabilityInstaller = {
    declaration: TOAST_RENDERER_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        // Layer B — moved verbatim from globals.ui.ts (setupUI, B9 notifications block).
        // `ui.notify` (the kernel primitive's adapter) stays there — see module doc.
        gl._UINotifications = _UINotifications;
        gl.NotificationSystem = NotificationSystem;
        gl.Notifications = Notifications;
    },

    createModule() {
        return new ToastRendererModule();
    },
};
