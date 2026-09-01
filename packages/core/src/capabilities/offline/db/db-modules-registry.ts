/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description ESM registry for IndexedDB sub-modules — Phase 10-B Pattern D
 *
 * Replaces the globalThis.GeoLeaf.Storage._DBModules mutable registry.
 * The IndexedDB core (indexeddb.js) imports this registry directly instead of
 * reading _DBModules from the global namespace at runtime.
 *
 * Each sub-module must expose an `init(db: IDBDatabase) => moduleAPI` function
 * consumed by IndexedDB._ensureModule().
 *
 * @example
 * import { DBModulesRegistry } from './db-modules-registry.js';
 * const mod = DBModulesRegistry['Images'];
 * if (mod && typeof mod.init === 'function') {
 *     const api = mod.init(db);
 * }
 */
import { DBFeatures } from "./features.js";
import { DBImages } from "./images.js";
import { DBLayers } from "./layers.js";
import { DBLocalEdit } from "./local-edit.js";
import { DBOutbox } from "./outbox.js";
import { DBPreferences } from "./preferences.js";
import { DBRoutes, type RoutesAPI } from "./routes.js";
import type { FeaturesDBInstance } from "./features.js";
import type { ImagesDBInstance } from "./images.js";
import type { LayersDBInstance } from "./layers.js";
import type { LocalEditDBInstance } from "./local-edit.js";
import type { OutboxDBInstance } from "./outbox.js";
import type { PreferencesAPI } from "./preferences.js";

/**
 * Instance API of any IndexedDB sub-module. Keeps the exported registry's type
 * nameable and binds the per-module instance types to an explicit usage site
 * (they are otherwise only reachable through type inference).
 */
type DBModuleInstance =
    | FeaturesDBInstance
    | ImagesDBInstance
    | LayersDBInstance
    | LocalEditDBInstance
    | OutboxDBInstance
    | PreferencesAPI
    | RoutesAPI;

/**
 * Registry of all IndexedDB sub-modules keyed by canonical name.
 * @type {Record<string, {init: function(IDBDatabase): object}>}
 */
const DBModulesRegistry = {
    Features: DBFeatures,
    Images: DBImages,
    Layers: DBLayers,
    LocalEdit: DBLocalEdit,
    Outbox: DBOutbox,
    Preferences: DBPreferences,
    Routes: DBRoutes,
} satisfies Record<string, { init(db: IDBDatabase): DBModuleInstance }>;

export { DBModulesRegistry };
