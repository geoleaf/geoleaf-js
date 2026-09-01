/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * UMD/ESM bridge — B3 + B4 — Helpers, Validators, Renderers, Data, Config.
 *
 * This runtime initialization module registers configuration and data services
 * on `globalThis.GeoLeaf`. It is imported as a side-effect by `globals.ts`.
 *
 * Registers:
 *   - **B3** — Helpers (DOM), Validators (schema, style),
 *     Renderers (abstract, simple-text), Data normalizer, Map factory
 *   - **B4** — Config (accessors, core, loaders, validation, primitives,
 *     profile loader, data converter, debug flag, normalization)
 *
 * @see globals for the orchestrator and import order
 */

// B3 : helpers, validators, data, loaders, map
import { StyleValidator } from "../utils/validators/style-validator.js";
import { StyleValidatorRules } from "../utils/validators/style-validator-rules.js";
// Scale relocated to the in-core `scale` capability (`GeoLeaf.Scale`, mounted by globals.ui).
// B4 : config
import { DataConverter } from "../kernel/geojson/loader/data-converter.js";
import { ConfigLoader } from "../kernel/config/loader.js";
import { Config } from "../kernel/config/geoleaf-config/config-core.js";
// Config sub-modules: side-effect imports that mutate the Config singleton.
// Must follow config-core.js. These run once per process (ESM) — they stay at
// module top-level and are NOT part of the re-callable setup below.
import "../kernel/config/geoleaf-config/config-loaders.js";
import "../kernel/config/geoleaf-config/config-accessors.js";
import "../kernel/config/geoleaf-config/config-validation.js";
import { ensureGeoLeaf } from "../utils/general/geoleaf-global.js";

/**
 * B3 + B4 — helpers, validators, data normalizer, loaders and the
 * `Config` singleton namespace. Re-callable; bound to the `config` module
 * lifecycle. Idempotent: all writes are conditional namespace creation or
 * reference re-assignment.
 */
export function setupConfig(): void {
    // Dynamic namespace registration: write through a bag view (see globals.ui).
    const _gl = ensureGeoLeaf() as unknown as Record<string, unknown>;
    // ── B3 assignations ──────────────────────────────────────────────────────
    // `Helpers` keeps only the DOM helpers. The three POI colour resolvers that used
    // to hang here were an orphan public API: zero production callers, and they
    // hard-coded `properties.categoryId` as the column to read. Layer styling is
    // owned by `styleRulesToPaint` (maplibre-style-converter), which resolves any
    // field. See the `taxonomy-painter` entry in the extracted-features guard.
    if (!_gl.Helpers) _gl.Helpers = {};
    if (!_gl._Validators) _gl._Validators = {};
    (_gl._Validators as Record<string, unknown>).StyleValidator = StyleValidator;
    (_gl._Validators as Record<string, unknown>).StyleValidatorRules = StyleValidatorRules;

    // ── B4 assignations ──────────────────────────────────────────────────────
    if (!_gl.Config) _gl.Config = Config;
    Object.assign(_gl.Config as object, Config);
    _gl._DataConverter = DataConverter;
    _gl._ConfigLoader = ConfigLoader;
    // `_StyleValidator`, `_ConfigNormalization` et `_ProfileLoader` retirées :
    // aucun lecteur, aucune déclaration de type.
}

// ── PHASE A — the facades, at import, in ESM order ───────────────────────────────────────────
//
// `setupConfig()` takes no parameters: it needs neither the map adapter nor the merged config,
// so there is nothing for the registry to order. It was made lazy by the micro-core split, which
// broke the boot twice — `46cd88dc` (GeoLeaf.I18n gone before boot(), plugins lost their dicts
// silently) and `192c6865` (APIController built at import with 0 managers). The compensation was
// a rustine in `built-in/api/controller.ts`, which fired this chain from a getter; S6 removed it.
//
// The inversion is structural, not accidental: `boot-core.ts` calls `loadConfig()` — which needs
// `GeoLeaf.Config.init` — BEFORE `registry.init()`, because the modules need the MERGED config to
// initialise. Facades are therefore a PREREQUISITE of the registry, not its product. Two phases,
// one way each: facades at import (ESM order is deterministic and already correct, see
// `globals.ts`), runtime at the registry (topological order).
setupConfig();
