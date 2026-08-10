/*!
 * GeoLeaf Core (toast-renderer capability) — Config reader
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Toast-renderer capability — config reader.
 *
 * Reads `modules.toast-renderer.*` from the core Config singleton (typed import —
 * the in-core equivalent of the former `GeoLeaf.Config.get` runtime seam) and
 * merges it over the built-in defaults. Capability-level gate only; the renderer's
 * layout defaults (position, maxVisible, animations) live in
 * `NotificationSystem.init()` and are not (yet) profile-configurable.
 */
"use strict";

import { Config } from "../../kernel/config/config-primitives.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/** The `modules.toast-renderer` capability-level config block. */
interface ToastRendererCapabilityConfig {
    /**
     * Capability gate — the renderer is inert when `false` (`GeoLeaf.notify`
     * degrades to `console.*`, rich surfaces become no-ops). Opt-out
     * (`enableWhenAbsent: true`): absent → active, preserving the pre-migration
     * default-on behaviour (toasts were always rendered).
     */
    enabled: boolean;
}

/**
 * Built-in defaults. `enabled` is `true` — the renderer is opt-out (active unless
 * a profile sets `modules.toast-renderer.enabled: false`).
 */
const DEFAULTS: ToastRendererCapabilityConfig = { enabled: true };

/**
 * Reads `modules.toast-renderer.*` from the running core config and merges it over
 * the built-in defaults.
 */
export function getToastRendererConfig(): ToastRendererCapabilityConfig {
    const raw =
        _Config.get?.<Partial<ToastRendererCapabilityConfig>>("modules.toast-renderer", {}) ?? {};
    return { ...DEFAULTS, ...raw };
}
