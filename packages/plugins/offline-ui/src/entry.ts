/*!
 * @geoleaf-plugins/offline-ui — Entry point (offline UI)
 * Registers the offline UI (cache button, layer selector, sync panel), i18n and toolbar.
 * The offline engine (IndexedDB / cache / download / sync) is in-core and loaded on demand.
 * ESM only — no UMD, no CommonJS. Loaded AFTER @geoleaf/core, BEFORE GeoLeaf.boot().
 * © 2026 Mattieu Pottier — MIT License
 *
 * ## ⚠️ No `public-api.ts` here, and it is a FINDING, not an oversight
 *
 * `connector` and the former `addpoi` were aligned on the `buildPublicApi()`
 * pattern, which brings them into the scope of `check-facade-purity.cjs` — a gate
 * that enumerates facades by FILE EXISTENCE. One might believe storage was left
 * aside. It is not: **it mounts no namespace of its own.**
 *
 * `GeoLeaf.Storage` is a CORE facade (the `offline` capability,
 * `kernel/storage/facade.ts`). This plugin DRIVES it — it registers the offline
 * UI, the i18n dictionaries and the toolbar — and its `healthCheck` says so in as
 * many words: `typeof _g.GeoLeaf?.Storage === "object"` queries a surface it did
 * not set.
 *
 * Creating an empty `public-api.ts` to "enter the gate" would be a structural
 * lie: the file would announce a facade where there is nothing to expose, and the
 * gate would validate it. A gate satisfied by a shell guards nothing.
 *
 * ⚠️ **This paragraph extended the finding to `route` AND `vector-tiles` "for the
 * same reason". Measured on 20/08/2026: true of `route`, false of
 * `vector-tiles`**, which mounts `gl._VectorTiles` from its own directory — hence
 * an own surface, declared moreover in `global.d.ts`. THIS file's finding stays
 * right; its extension was not.
 * https://geoleaf.dev
 */
import "./css/cache-modal.css";
import "./css/cache-control.css";
import "./css/cache-sync.css";
// Offline UI only — the engine (IndexedDB / cache / download / sync / poi-restore) now
// lives in-core (`@geoleaf/core` `capabilities/offline`) and is loaded on demand by the
// capability loader (dynamic `import()` on `ensureLoaded`). S14 Phase B (B3).
import "./cache/download-handler.js";
import "./cache/layer-selector/core.js";
import "./cache/layer-selector/data-fetching.js";
import "./cache/layer-selector/row-rendering.js";
import "./cache/layer-selector/selection-cache.js";
import "./sync/sync-manager.js";
import "./cache/cache-control.js";
import "./ui/cache-button/button-control.js";
import "./ui/cache-button/modal-manager.js";
import "./ui/cache-button/export-logic.js";
import "./ui/cache-button.js";
import { registerCacheToolbar } from "./ui/cache-button/toolbar-registration.js";
import { wireEngineSignals } from "./core/engine-signals.js";
import langFr from "./lang/lang-fr.js";
import langEn from "./lang/lang-en.js";
import langEs from "./lang/lang-es.js";
import langPt from "./lang/lang-pt.js";
import langIt from "./lang/lang-it.js";
import langDe from "./lang/lang-de.js";
import type { GeoLeafHost } from "@geoleaf/host-runtime";

const _g = (typeof globalThis !== "undefined" ? globalThis : {}) as { GeoLeaf?: GeoLeafHost };

// The offline engine now lives in-core (`capabilities/offline`) and is wired into the
// `GeoLeaf.Storage` façade by the capability loader (dynamic import on `ensureLoaded`),
// not here — S14 Phase B (B3). This plugin ships only the offline UI + i18n + toolbar.

// Register i18n dictionaries FIRST so the toolbar label resolves during boot.
//
// ⚠️ Plugin rename — the namespace becomes `offline-ui`, NOT the key prefix,
// which stays `storage.*`. The two are independent: `registerDict(ns, dicts)`
// files under `_pluginDicts[ns]` then flattens everything, and `getLabel`
// resolves on the flat key alone — the namespace is just a bucket. Renaming the
// prefix would be a distinct and far larger gesture: 105 keys × 6 locales, 121
// call sites, and above all a PROFILE OVERRIDE surface (`_overrides[key]`), hence
// a public contract the package rename does not commit.
_g.GeoLeaf?.I18n?.registerDict?.("offline-ui", {
    fr: langFr,
    en: langEn,
    es: langEs,
    pt: langPt,
    it: langIt,
    de: langDe,
});

if (_g.GeoLeaf?.plugins?.register) {
    _g.GeoLeaf.plugins.register("offline-ui", {
        // Plugin version, injected at build by @rollup/plugin-replace (pkg.version) —
        // the plugin's own version, not the core's. INV-REG / PC-11.
        version: "__GEOLEAF_VERSION__",
        optional: ["editor"],
        label: "Offline UI (cache button, layer selector, sync panel)",
        // UI-only health: the plugin drives the in-core Storage façade — its presence is the
        // signal. The offline engine is opt-in (modules.offline) and loaded on demand, so it
        // MUST NOT be probed here (else the plugin reads unhealthy when offline is disabled).
        healthCheck: () => typeof _g.GeoLeaf?.Storage === "object",
    });
}

// Register the toolbar slot (desktop band + mobile pill) instead of the former
// top-left MapLibre control, and wire the open-modal listener.
registerCacheToolbar(_g);

// Make audible the signals the ENGINE emitted with nobody listening: quota
// overflow and budget eviction. Exactly the two that the non-evictable store and
// the tile-cache arbitration need to be observable — an engine managing the quota
// without ever saying so is indistinguishable, from outside, from one that does
// not.
//
// ⚠️ Wired HERE, at entry import, and not in the modal's lifecycle: these signals
// fire at DOWNLOAD and WRITE time, i.e. while the cache UI is closed. Wiring them
// at panel opening would have missed them precisely when they happen.
wireEngineSignals();

// ─── Published TYPE surface ──────────────────────────────────────────────────
//
// ⚠️ Without this block, `dist/types/entry.d.ts` contains only side-effect
// imports, and the PUB-TYPES gate comes out GREEN on an EMPTY surface: it checks
// that the `types` condition's target exists, not that it declares anything.
// `typeof import("@geoleaf-plugins/…")` would be `{}`, the integrator would
// believe the package typed, and the work would have delivered nothing.
//
// It is the pattern of `cog`, `measure` and `print`: the entry re-exports the
// types the package publicly assumes. What is not here is NOT published — the
// decision, not an oversight.
export type {
    StorageContractShape,
    StorageContractDB,
    StorageContractCacheManager,
    StorageContractCacheStorage,
    StorageContractLayerSelector,
    StorageContractCache,
} from "./shared/storage-contract.js";
