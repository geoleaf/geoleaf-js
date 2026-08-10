/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf API — Barl export
 * B4 [ARCH-02]: point d'input unique for the sous-module api/
 */
export { APIController } from "./controller.js";
export { APIFactoryManager } from "./factory-manager.js";
export { APIInitializationManager } from "./initialization-manager.js";
export { APIModuleManager } from "./module-manager.js";
export { PluginRegistry } from "./plugin-registry.js";
export { BootInfo, showBootInfo } from "./boot-info.js";
// Mediated route for the `capabilities/ → kernel/` boundary (backlog R.8):
// capabilities read their own opt-out gate through the registry.
export { CapabilityRegistry } from "./capability-registry.js";
// Note: GeoLeafAPI is NOT exported from the barl — it is a stateful assembler
// with load-order dependencies. Import directly from ./geoleaf-api.js when needed.
