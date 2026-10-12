/*!
 * @geoleaf-plugins/isochrone — Built-in provider registration
 *
 * Registers the engine this package ships with. Imported for its side effect by `entry.ts`.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * ## Why registration is a side effect and not a call the host must remember
 *
 * The registry exists so an integrator can plug an engine this package does not know. The one
 * it DOES know must not need that door: a plugin whose built-in only works once the host calls
 * a setup function has a configuration that silently does nothing until someone reads the
 * README.
 *
 * ⚠️ Registering here rather than in `entry.ts` keeps the entry a list of steps. It also means
 * an integrator replacing `valhalla` with their own adapter must register AFTER the plugin has
 * loaded — the same name registered twice keeps the second.
 *
 * @sideEffectGraft packages/plugins/isochrone/src/entry.ts
 */

import { registerProvider } from "../provider.js";
import { createValhallaProvider } from "./valhalla.js";

registerProvider("valhalla", createValhallaProvider);
