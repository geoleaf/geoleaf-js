/*!
 * @geoleaf-plugins/editor — Layer edition permission gate
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * @description
 * La permission de couche, appliquée AVANT le choix du chemin — tâche 8.7 (B-138 / B-139).
 *
 * ## Ce qui était mesuré, et pourquoi une seule garde suffit
 *
 * 🛑 **La permission n'était appliquée que HORS LIGNE.** `applyEdit` (core) refuse depuis 5.9
 * sur `edition.{create,update,delete}`, mais on n'y passe que lorsque le réseau est absent.
 * Connecté, `rest-adapter.ts` émet un `DELETE` **inconditionnel** : une couche déclarant
 * `edition.delete: false` restait supprimable dès qu'on avait du réseau (**B-138**).
 *
 * ⚠️ **Et la placer dans `auto-adapter._route` n'aurait pas suffi.** `createPersistenceAdapter`
 * rend l'adaptateur REST **nu** en `persistence.mode: "online"` — sans jamais construire
 * l'adaptateur automatique. Une garde posée dans le routage aurait donc laissé le mode le plus
 * exposé entièrement ouvert. Elle est ici, en décorateur du seul objet que **tous** les modes
 * traversent.
 *
 * ## Pourquoi ce n'est pas qu'une étiquette (B-139)
 *
 * Le refus lève `PersistenceError("forbidden")`, et `_isTransportError` (`auto-adapter.ts`)
 * ne connaît que `"network"` et `"timeout"`. Un refus de permission ne retombe donc **pas**
 * dans la file : c'est la moitié qui compte. Typé `"network"` comme avant, il aurait été
 * présenté comme réessayable et remis en file — une écriture qui ne pourra jamais aboutir,
 * réessayée indéfiniment.
 *
 * ## Absent vaut REFUSÉ, y compris pour le prédicat lui-même
 *
 * ⚠️ Quand la façade ne sait pas répondre (`GeoLeaf.Storage` absent, ou sans `mayEdit`), la
 * garde **refuse**. C'est la règle que `LayerEditionPermissions` pose déjà pour les clés —
 * « déclarer n'est pas accorder, absent vaut refusé » — étendue au cas où l'on ne peut pas
 * lire la déclaration. L'inverse ferait de toute panne d'assemblage une autorisation
 * silencieuse, c'est-à-dire ferait revenir B-138 sans que rien ne rougisse.
 *
 * 🛑 **Conséquence assumée pour les doubles de test** : une suite qui monte
 * `GeoLeaf.Storage = { applyEdit }` sans `mayEdit` se voit refuser. C'est voulu — un double
 * incomplet est « un plugin vert contre sa propre fiction du global », la cause racine n° 1
 * de cette roadmap. Les doubles déclarent désormais le prédicat.
 */
import { _getLabel } from "../internal.js";
import { storageFacade } from "./storage-seam.js";
import {
    PersistenceError,
    type EditorFeature,
    type EditorPersistenceAdapter,
    type UpdateOptions,
} from "./adapter-interface.js";

/** L'opération soumise, dans le vocabulaire du contrat de synchronisation. */
type EditKind = "create" | "update" | "delete";

/**
 * Refuse l'opération si la couche ne l'accorde pas.
 *
 * @param layerId - Couche hôte visée par l'écriture.
 * @param kind - L'opération soumise.
 * @throws {PersistenceError} `kind: "forbidden"` quand la couche refuse, ou quand la façade
 *   ne peut pas être interrogée.
 */
function _assertPermitted(layerId: string, kind: EditKind): void {
    const facade = storageFacade();
    if (typeof facade?.mayEdit !== "function") {
        throw new PersistenceError(
            "forbidden",
            `editor: cannot check edition permission for "${layerId}" — GeoLeaf.Storage.mayEdit ` +
                `is unavailable. Refusing rather than assuming the layer grants ${kind}.`
        );
    }
    // Récepteur conservé — `facade.mayEdit(...)` et NON un appel détaché. La façade du core
    // n'est pas une fermeture, et c'est la classe de défaut B-128 (cf. `storage-queue-adapter`).
    if (!facade.mayEdit(layerId, kind)) {
        throw new PersistenceError("forbidden", _getLabel("editor.error.editionNotPermitted"), {});
    }
}

/**
 * Enveloppe un adaptateur de persistance d'une garde de permission de couche.
 *
 * Appliquée par `adapter-factory.ts` à **chaque** mode (`online`, `offline`, `auto`, dialecte
 * `collection`), pour que la permission ne dépende plus du chemin emprunté.
 *
 * ⚠️ **N'enveloppe PAS l'adaptateur du rejeu.** `createOnlineAdapter` reste nu pour
 * `editor-sync-replay.ts` : une entrée déjà en file a passé la garde à sa mise en file, et une
 * couche devenue non inscriptible depuis relève de la **quarantaine** du core
 * (`layerNoLongerWritable`), pas d'un refus au vol du drain.
 *
 * @param inner - L'adaptateur concret à protéger.
 * @returns Le même contrat, refusant ce que la couche n'accorde pas.
 */
export function withEditionPermissions(inner: EditorPersistenceAdapter): EditorPersistenceAdapter {
    // 🛑 LES TROIS MÉTHODES SONT `async`, ET CE N'EST PAS COSMÉTIQUE.
    //
    // `_assertPermitted` jette de façon SYNCHRONE. Sans `async`, le refus remonterait en
    // exception au lieu d'une promesse rejetée — or le contrat
    // (`EditorPersistenceAdapter`) dit « Every method rejects with a PersistenceError on
    // failure », et un appelant qui écrit `adapter.save(…).catch(…)` sans `await` verrait
    // l'exception traverser son `.catch`. Mesuré : la première rédaction de ce décorateur
    // faisait exactement ça, et la garde l'a attrapée au premier run.
    return {
        async save(feature: EditorFeature, layerId: string) {
            _assertPermitted(layerId, "create");
            return inner.save(feature, layerId);
        },
        async update(feature: EditorFeature, layerId: string, opts?: UpdateOptions) {
            _assertPermitted(layerId, "update");
            return inner.update(feature, layerId, opts);
        },
        async delete(featureId: string, layerId: string) {
            _assertPermitted(layerId, "delete");
            return inner.delete(featureId, layerId);
        },
        isOnline: () => inner.isOnline(),
    };
}
