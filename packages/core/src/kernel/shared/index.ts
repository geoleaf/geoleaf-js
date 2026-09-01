/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Public barrel for the cross-module shared contracts.
 *
 * Mediated entry point for the `capabilities/ → kernel/` boundary (backlog R.8).
 *
 * `StorageContract` is a passive registry: it has NO top-level side effect. `init()` is
 * driven by the `geoleaf.storage.ts` facade when the Storage plugin loads — importing
 * this barrel neither opens IndexedDB nor arms anything.
 */

export { StorageContract } from "./storage-contract.js";

// Second export of the barrel. It is here because the import boundary requires it:
// `capabilities/legend/lifecycle.ts` reads this state, and ESLint forbids
// `capabilities/**` to import deep under `kernel/**` — only barrels, type hubs and
// seams are reachable. Widening this barrel is its intended use, not a workaround;
// it is the gesture the rule DESIGNATES, and it is explicit by construction.
// Only the READER crosses the boundary: `capabilities/legend/lifecycle.ts` reads the
// state, nobody writes it from a capability. The writer
// (`globals/globals.geojson.ts`) is outside `capabilities/`, so the rule does not
// apply to it — it imports the file directly. Re-exporting `setAllLayerConfigs`
// here would open writing to every capability for zero callers: knip flagged it,
// and it was right.
export { getAllLayerConfigs } from "./layer-configs-state.js";

// The edit-authorisation rule AND the two profile accessors, re-exported because
// the boundary requires it: `capabilities/offline/` consumes them
// (`local-edit-api.ts` applies the rule, `config-seam.ts` re-exports the accessors
// under their original names) and cannot import deep under `kernel/**`.
//
// ⚠️ **Widening this barrel is here the gesture the rule DESIGNATES**, not a
// workaround — and it was added AFTER the fact: the first draft exported only
// `grantsEdition`, betting the accessors would stay internal to the kernel. ESLint
// refused `config-seam.ts`'s deep import and it was right, the bet being false from
// the very next line.
//
// ⚠️ `mayEditLayer` is NOT here, deliberately: its only caller is the
// `kernel/storage/facade.ts` facade, on the same side of the boundary, which
// imports the module directly. Exposing it would have no capability consumer —
// knip would be right to flag it.
export { grantsEdition, profileLayerConfig, profileLayers } from "./edition-permissions.js";

// Tool cursor (14/08/2026) — re-exported because the boundary requires it:
// `capabilities/filter/` arms the proximity-search cursor and cannot import deep
// under `kernel/**`. Again the gesture the rule DESIGNATES.
//
// ⚠️ `isExclusiveMode` and `cursorTarget` are NOT here, deliberately: their only
// callers (`adapters/maplibre/maplibre-{poi,cluster}-builders.ts`) are outside
// `capabilities/`, so the rule does not apply to them — they import the module
// directly. Exposing them here would have no capability consumer, and knip would be
// right to say so.
export { armToolCursor, disarmToolCursor } from "./map-cursor.js";

// Profile storage keys (18/08/2026) — one declaration for keys that have TWO writers on two
// sides of the app/capability boundary; a drifting copy would make the boot silently stop
// seeing the user's choice. Motives in `profile-storage-keys.ts`.
export { PROFILE_STORAGE_KEY, SELECTED_PROFILE_STORAGE_KEY } from "./profile-storage-keys.js";
