/*!
 * @geoleaf-plugins/offline-ui — Entry point (offline UI)
 * Registers the offline UI (cache button, layer selector, sync panel), i18n and toolbar.
 * The offline engine (IndexedDB / cache / download / sync) is in-core and loaded on demand.
 * ESM only — no UMD, no CommonJS. Loaded AFTER @geoleaf/core, BEFORE GeoLeaf.boot().
 * © 2026 Mattieu Pottier — MIT License
 *
 * ## ⚠️ Pas de `public-api.ts` ici, et c'est un CONSTAT, pas un oubli (API publique S4.7c)
 *
 * La tâche 4.7 a aligné `connector` et l'ancien `addpoi` sur le patron `buildPublicApi()`, ce qui les
 * fait entrer dans le champ de `check-facade-purity.cjs` — une gate qui énumère les façades
 * par EXISTENCE DE FICHIER. On pourrait croire storage laissé de côté. Il ne l'est pas :
 * **il ne monte aucun namespace propre.**
 *
 * `GeoLeaf.Storage` est une façade du CORE (capacité `offline`, `kernel/storage/facade.ts`).
 * Ce plugin la PILOTE — il enregistre l'UI hors-ligne, les dictionnaires i18n et la barre
 * d'outils — et son `healthCheck` le dit en toutes lettres : `typeof _g.GeoLeaf?.Storage ===
 * "object"` interroge une surface qu'il n'a pas posée.
 *
 * Créer un `public-api.ts` vide pour « entrer dans la gate » serait un mensonge de structure :
 * le fichier annoncerait une façade là où il n'y a rien à exposer, et la gate le validerait.
 * Une gate satisfaite par une coquille ne garde rien.
 *
 * Le même constat vaut pour deux capacités du core, `route` et `vector-tiles` — également sans
 * `public-api.ts`, et pour la même raison. Consigné au backlog technique.
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
// ⚠️ STRUCT S3.2 — le namespace passe à `offline-ui`, PAS le préfixe des clés, qui reste
// `storage.*`. Les deux sont indépendants : `registerDict(ns, dicts)` range dans
// `_pluginDicts[ns]` puis aplatit tout, et `getLabel` résout sur la clé plate seule — le
// namespace n'est qu'un seau. Renommer le préfixe serait un geste distinct et bien plus
// large : 105 clés × 6 locales, 121 sites d'appel, et surtout une surface d'OVERRIDE DE
// PROFIL (`_overrides[key]`), donc un contrat public que le renommage du paquet n'engage pas.
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

// Rendre audibles les signaux que le MOTEUR émettait sans que personne n'écoute (B-72) :
// dépassement de quota et éviction par budget. Ce sont exactement les deux dont les tâches
// 3.4 et 3.13 ont besoin pour être observables — un moteur qui gère le quota sans jamais le
// dire ne se distingue pas, de l'extérieur, d'un moteur qui ne le gère pas.
//
// ⚠️ Câblé ICI, à l'import de l'entrée, et non dans le cycle de vie de la modale : ces
// signaux partent au TÉLÉCHARGEMENT et à l'ÉCRITURE, c'est-à-dire quand l'interface de cache
// est fermée. Les brancher à l'ouverture du panneau les aurait manqués précisément quand ils
// se produisent.
wireEngineSignals();

// ─── Surface de TYPES publiée — API publique S4.4c ───────────────────────────
//
// ⚠️ Sans ce bloc, `dist/types/entry.d.ts` ne contient que des imports d'effet de bord, et la
// gate PUB-TYPES sort VERTE sur une surface VIDE : elle vérifie que la cible de la condition
// `types` existe, pas qu'elle déclare quoi que ce soit. `typeof import("@geoleaf-plugins/…")`
// vaudrait `{}`, l'intégrateur croirait le paquet typé, et la tâche n'aurait rien livré.
//
// C'est le patron de `cog`, `measure` et `print` : l'entrée ré-exporte les types que le paquet
// assume publiquement. Ce qui n'est pas ici n'est PAS publié — c'est la décision, pas un oubli.
export type {
    StorageContractShape,
    StorageContractDB,
    StorageContractCacheManager,
    StorageContractCacheStorage,
    StorageContractLayerSelector,
    StorageContractCache,
} from "./shared/storage-contract.js";
