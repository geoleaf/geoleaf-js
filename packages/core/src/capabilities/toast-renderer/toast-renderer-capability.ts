/*!
 * GeoLeaf Core (toast-renderer capability) — Capability declaration
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `toast-renderer` capability.
 *
 * Registered in `boot.ts` before the optional module gate so that
 * `GeoLeaf.Introspection.getAllCapabilities()` and
 * `getCapabilitySchema('toast-renderer')` work at runtime. Relocated to
 * `capabilities/toast-renderer/` (S7) — the DOM renderer of the toast/notification
 * subsystem. The kernel keeps the lossy `notify()` primitive (anchor B2); this
 * capability registers itself as its renderer and re-mounts the rich surfaces.
 *
 * Config gate: `modules.toast-renderer.enabled`. `enableWhenAbsent: true` — opt-out
 * (active unless a profile sets it to `false`), preserving the pre-migration
 * default-on behaviour so geolocation/storage toasts keep rendering.
 */
"use strict";

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";

/** In-core capability declaration for the toast/notification renderer. */
export const TOAST_RENDERER_CAPABILITY: ICapabilityDeclaration = {
    id: "toast-renderer",
    label: "Toast Renderer",
    description: "DOM renderer for the notification toasts emitted through GeoLeaf.notify().",
    gate: {
        configPath: "modules.toast-renderer.enabled",
        enableWhenAbsent: true,
    },
    configSchema: {
        enabled: {
            type: "boolean",
            default: true,
            description: "Enable or disable the toast renderer globally (opt-out).",
        },
    },
    // No loader: the renderer is inline (present in Full and Lite). Gated via config.
};
