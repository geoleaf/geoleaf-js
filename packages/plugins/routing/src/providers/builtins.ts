/*!
 * @geoleaf-plugins/routing — Built-in provider registration
 *
 * Registers the two engines this package ships with. Imported for its side effect by `entry.ts`.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { registerProvider } from "../provider.js";
import { getPluginConfig } from "../config.js";
import { createValhallaProvider } from "./valhalla.js";
import { createOsrmProvider } from "./osrm.js";
import { DEFAULT_TIMEOUT_MS } from "./http.js";

/**
 * ## Why registration is a side effect and not a call the host must remember
 *
 * The registry exists so an integrator can plug an engine this package does not know. The two it
 * DOES know must not need that door: a plugin whose built-ins only work if the host calls a setup
 * function has a configuration that silently does nothing until someone reads the README.
 *
 * ⚠️ Registering here rather than in `entry.ts` keeps the entry a list of steps. It also means an
 * integrator overriding `valhalla` with their own instance must register AFTER importing the
 * plugin — which is the documented order, and the same one `position-share` uses for transports.
 */
/**
 * The configured timeout, read at CONSTRUCTION and not at module load.
 *
 * ⚠️ The difference matters: this module is imported at plugin load, before `GeoLeaf.boot()` has
 * necessarily merged the profile. Reading the configuration here, at the top level, would freeze
 * whatever the defaults were — and an integrator's `timeoutMs` would be silently ignored, with a
 * plugin that works and a setting that does nothing.
 *
 * @returns The timeout in milliseconds.
 */
function timeoutMs(): number {
    const v = getPluginConfig().timeoutMs;
    // A non-positive or non-finite value falls back rather than being honoured: `0` would abort
    // every request before it left, which is indistinguishable from an engine that never answers.
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : DEFAULT_TIMEOUT_MS;
}

registerProvider("valhalla", (endpoint) => createValhallaProvider(endpoint, timeoutMs()));
registerProvider("osrm", (endpoint) => createOsrmProvider(endpoint, timeoutMs()));
