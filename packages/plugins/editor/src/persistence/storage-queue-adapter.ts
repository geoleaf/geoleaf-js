/*!
 * @geoleaf-plugins/editor — Storage-queue persistence adapter (offline)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Offline backend: write-through to the core's optimistic write cycle
 * (`GeoLeaf.Storage.applyEdit`), which writes the entity and its outbox entry in ONE
 * transaction. Replaying on reconnect is owned by {@link ./editor-sync-replay}, which
 * delegates to the core drain — not by addpoi's handler.
 *
 * ⚠️ **Cet en-tête décrivait la file v3 jusqu'au 04/08/2026**, et il était faux depuis 4.9 :
 * « write-through to the shared IndexedDB sync queue (`addToSyncQueue`) […] stores a generic
 * editor envelope under the entry `payload` ». Ni `addToSyncQueue`, ni l'enveloppe `payload`,
 * ni le partage de file avec `addpoi` n'existent plus. La prose survit au code parce qu'aucune
 * gate ne peut la lire : la VÉRACITÉ d'une phrase n'a pas de vérificateur, et n'en aura jamais.
 *
 * The Storage façade is read at call time (`globalThis.GeoLeaf.Storage`), never
 * imported — importing it would bundle a dead copy with no live `.DB`.
 * https://geoleaf.dev
 */
import { _getLabel } from "../internal.js";
import { storageFacade } from "./storage-seam.js";
import {
    PersistenceError,
    type EditorFeature,
    type EditorPersistenceAdapter,
    type SavedFeature,
} from "./adapter-interface.js";
import { dispatchEditorEvent } from "../editor-events.js";

/** Emits `geoleaf:editor:feature-sync-queued` once an entry is persisted. */
function _dispatchQueued(kind: string, layerId: string, entryId: string): void {
    dispatchEditorEvent("geoleaf:editor:feature-sync-queued", { kind, layerId, entryId });
}

/**
 * Met UNE opération en file, par le point d'écriture du core.
 *
 * 🛑 **TÂCHE 4.9 — LE SECOND VOCABULAIRE DISPARAÎT ICI.** Ce plugin empilait
 * `editor.save` / `editor.update` / `editor.delete` sous une clé `payload`, pendant
 * qu'`addpoi` empilait `add_poi*` sous une clé `poiData`, **dans la même file v3**. Deux
 * vocabulaires qui ne se rencontraient jamais : `poi-restore` n'en connaissait qu'un et
 * écartait l'autre comme « foreign » — donc une géométrie tracée hors réseau **n'était jamais
 * réaffichée**. Le contrat gèle `SyncOperationKind` précisément pour ça, entity-generic parce
 * que le magasin l'est.
 *
 * ⚠️ **Rien n'est refusé ici.** La garde d'éditabilité (invariant S6) et celle de la géométrie
 * vivent dans le core, seul endroit qui lit la déclaration de couche. Refuser une saisie déjà
 * faite serait la perdre.
 *
 * @param kind - L'opération, dans le vocabulaire du contrat.
 * @param layerId - Couche hôte.
 * @param localId - Identité de l'entité ; absente pour une création, que le core frappe.
 * @param feature - L'entité éditée. Absente pour une suppression.
 * @returns L'identifiant de l'entrée de file.
 * @throws Quand le moteur de stockage est absent, ou que le core refuse l'édition.
 */
async function _enqueue(
    kind: "create" | "update" | "delete",
    layerId: string,
    localId: string | undefined,
    feature?: EditorFeature
): Promise<string> {
    // 🛑 LE RÉCEPTEUR EST OBLIGATOIRE, ET SON ABSENCE ÉTAIT B-128.
    //
    // Ce corps faisait `const applyEdit = facade?.applyEdit` puis `applyEdit({…})` — un appel
    // DÉTACHÉ. La façade du core n'est pas une fermeture : `applyEdit` y lit `this._modules`
    // pour joindre le moteur. Sans récepteur, `this` vaut `undefined` et l'appel jette
    // `TypeError: Cannot read properties of undefined (reading '_modules')`.
    //
    // ⚠️ Le typecheck ne peut pas l'attraper : ce plugin **redéclare** la surface qu'il attend
    // (INV-NS lui interdit d'importer les sources du core), et une méthode redéclarée perd la
    // contrainte de `this` que le core exprime. C'est la même famille que la cause racine n° 1
    // de cette roadmap — un plugin vert contre sa propre fiction du global.
    //
    // Mesuré : la sauvegarde hors ligne fermait sa modale, n'écrivait RIEN, et n'émettait pas
    // `geoleaf:editor:feature-sync-queued`. Le rejet partait en `unhandledrejection`, donc sans
    // notification à l'utilisateur — une saisie de terrain perdue en silence.
    const facade = storageFacade();
    if (!facade?.applyEdit) {
        throw new PersistenceError("network", _getLabel("editor.error.storageUnavailable"));
    }
    const report = await facade.applyEdit({
        layerId,
        kind,
        ...(localId !== undefined && { localId }),
        ...(feature && {
            feature: {
                type: "Feature",
                geometry: feature.geometry,
                properties: feature.properties,
            },
        }),
    });
    if (report.refused) {
        // 🛑 UN REFUS DE PERMISSION N'EST PAS UNE PANNE RÉSEAU — tâche 8.7 (B-139).
        //
        // Cette ligne typait TOUT refus en `"network"`, y compris `deleteNotPermitted` et
        // `layerNotEditable`. Or `auto-adapter._isTransportError` traite `"network"` comme
        // **réessayable** : le refus était donc présenté comme un problème de connectivité,
        // c'est-à-dire comme quelque chose qui marchera au prochain essai. Il ne marchera
        // jamais, et l'écriture repartait en file à chaque tentative.
        //
        // ⚠️ Le partage se fait sur ce que le motif DIT, pas sur sa forme : `engineUnavailable`
        // et `malformedEdit` ne sont pas des refus de permission et gardent leur type.
        const isPermissionRefusal =
            report.refused === "deleteNotPermitted" ||
            report.refused === "layerNotEditable" ||
            report.refused === "layerUnknown";
        throw new PersistenceError(
            isPermissionRefusal ? "forbidden" : "network",
            `editor: edit refused (${report.refused})`
        );
    }
    const entryId = report.entryId ?? "";
    _dispatchQueued(kind, layerId, entryId);
    return entryId;
}

/**
 * Optimistic {@link SavedFeature} echoed back to the caller. Offline we have no
 * server id, so we keep the local id — enough for host-reconcile to commit the
 * geometry to the host layer; the real id arrives when the queue is flushed.
 */
function _optimisticSaved(feature: EditorFeature, layerId: string): SavedFeature {
    return {
        id: feature.id ?? "",
        layerId,
        geometry: feature.geometry,
        properties: feature.properties,
    };
}

/**
 * Creates an offline {@link EditorPersistenceAdapter} that write-throughs to the
 * Storage sync queue. `isOnline()` is always `false`: this adapter never reaches
 * the backend directly — the {@link ./auto-adapter} decides when to use it and
 * the replay handler flushes it on reconnect.
 */
export function createStorageQueueAdapter(): EditorPersistenceAdapter {
    return {
        async save(feature: EditorFeature, layerId: string): Promise<SavedFeature> {
            await _enqueue("create", layerId, feature.id, feature);
            return _optimisticSaved(feature, layerId);
        },

        async update(feature: EditorFeature, layerId: string): Promise<SavedFeature> {
            await _enqueue("update", layerId, feature.id, feature);
            return _optimisticSaved(feature, layerId);
        },

        async delete(featureId: string, layerId: string): Promise<void> {
            await _enqueue("delete", layerId, featureId);
        },

        isOnline(): boolean {
            return false;
        },
    };
}
