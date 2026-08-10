/*!
 * GeoLeaf Core (kernel/shared) — Layer edition permissions
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Le droit d'éditer une couche — la règle, et l'accès à la déclaration qui la porte.
 *
 * ## Pourquoi ce module est dans le GRAPHE DE BOOT et pas dans le moteur hors-ligne
 *
 * 🛑 **Parce que la permission se lit dans le PROFIL, pas dans IndexedDB.** La règle a vécu
 * jusqu'au 07/08/2026 en fonction privée de `capabilities/offline/write/local-edit-api.ts`
 * (`_grants`), donc dans le chunk différé, donc atteignable seulement par le chemin qu'on
 * emprunte quand le réseau est absent. Conséquence mesurée (**B-138**) : un utilisateur
 * **connecté** passait par `editor/src/persistence/rest-adapter.ts`, qui émet un `DELETE`
 * inconditionnel, et une couche déclarant `edition.delete: false` restait supprimable.
 * **La permission n'était appliquée que sur le chemin où elle était atteignable.**
 *
 * ⚠️ Et l'y laisser en la routant par le sac `edit` de la façade n'aurait rien réparé :
 * `@geoleaf-plugins/editor` déclare `requires: []` et tourne en `persistence.mode: "online"`
 * sans aucun moteur hors-ligne. Le prédicat aurait été indisponible **exactement** dans le
 * cas qui portait le trou.
 *
 * ## Une seule implémentation, et c'est le compteur C4
 *
 * `applyEdit` et la façade appellent {@link grantsEdition} — la même fonction, pas deux
 * lectures d'une même règle. Deux implémentations d'une autorisation divergent, et celle qui
 * diverge en dernier est celle que personne ne relit.
 *
 * @version 1.0.0
 */
"use strict";

import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import type { LayerEditionPermissions, SyncOperationKind } from "../../contracts/sync.contract.js";

/**
 * Lit TOUTES les déclarations de couche du profil actif, dans l'ordre du profil.
 *
 * 🛑 **N'utilise PAS `getAllLayerConfigs()`, et c'est mesuré.** Le baril voisin expose bien
 * cet accesseur, mais `kernel/geojson/loader/profile.ts` le remplit avec une **projection en
 * liste blanche** — `id, label, layerManagerId, configFile, zIndex, themes, geometry,
 * geometryType, styles, labels`. Ni `edition`, ni `offline`, ni `data`, ni `write`. Un
 * lecteur de permission qui passerait par là verrait `edition === undefined` pour **toute**
 * couche et refuserait tout, en silence.
 *
 * ⚠️ **Et ce n'est PAS `Config.Profile.getActiveProfileLayersConfig()`** : le sous-objet
 * `Profile` n'est pas monté sur `globalThis.GeoLeaf.Config`, et l'appel lève. Mesuré en
 * navigateur à la tâche 4.1, après un test unitaire vert qui moquait la forme espérée.
 *
 * @returns Les déclarations de couche, ou `[]` si aucun profil n'est chargé.
 */
export function profileLayers(): Array<Record<string, unknown>> {
    const profile: unknown = getGeoLeaf()?.Config?.getActiveProfile?.();
    if (!profile || typeof profile !== "object") return [];
    const raw = (profile as { layers?: unknown }).layers;
    if (!Array.isArray(raw)) return [];
    // `Array.isArray` sur un `unknown` narrow en `any[]` : re-typer explicitement, sinon
    // `find` rend `any` et la valeur traverse la frontière de typage sans être vérifiée.
    const layers = raw as unknown[];
    return layers.filter(
        (layer): layer is Record<string, unknown> => !!layer && typeof layer === "object"
    );
}

/**
 * Lit UNE couche — l'intégralité de son `<id>_config.json`, tel que fusionné au profil actif.
 *
 * Mêmes sources et mêmes pièges que {@link profileLayers}, dont c'est la projection unitaire.
 *
 * @param layerId - Identifiant de la couche.
 * @returns La configuration complète, ou `null` si le profil ou la couche est absent.
 */
export function profileLayerConfig(layerId: string): Record<string, unknown> | null {
    const found = profileLayers().find((layer) => (layer as { id?: unknown }).id === layerId);
    return found ?? null;
}

/**
 * La déclaration accorde-t-elle cette opération ? — le gate par opération de la décision V1.
 *
 * ⚠️ **Absent vaut REFUSÉ**, et un bloc `edition` présent mais vide n'accorde rien non plus :
 * déclarer n'est pas accorder. Aucune clé n'en implique une autre — `update` n'accorde pas
 * `delete`. Dériver l'une de l'autre est le mécanisme exact par lequel `enableEditionFull`
 * avait acquis un nom qui mentait.
 *
 * Un `edition` mal formé (chaîne, tableau, `null`) ne vaut pas mieux qu'absent : il n'accorde
 * rien. On ne jette pas — le schéma de profil refuse déjà la forme à la validation, et cette
 * branche ne couvre qu'un profil monté à la main, par un test ou par un hôte.
 *
 * @param declared - La valeur brute de la clé `edition` de la couche, non validée.
 * @param kind - L'opération soumise.
 * @returns `true` seulement si la clé correspondante vaut littéralement `true`.
 */
export function grantsEdition(declared: unknown, kind: SyncOperationKind): boolean {
    if (declared === null || typeof declared !== "object" || Array.isArray(declared)) return false;
    return (declared as LayerEditionPermissions)[kind] === true;
}

/**
 * La couche accorde-t-elle cette opération ? — le prédicat, rendu INTERROGEABLE avant écriture.
 *
 * C'est ce que `applyEdit` applique hors ligne, et ce que le plugin d'édition consulte
 * désormais **avant de choisir son chemin**, donc y compris quand il est connecté (B-138).
 *
 * ⚠️ Une couche inconnue rend `false`. Refuser l'inconnu est le même choix qu'`applyEdit`
 * (`layerUnknown`), et l'inverse ferait d'une faute de frappe une autorisation.
 *
 * @param layerId - L'identifiant de couche du profil actif.
 * @param kind - L'opération soumise.
 * @returns `true` seulement si la couche accorde littéralement cette opération.
 */
export function mayEditLayer(layerId: string, kind: SyncOperationKind): boolean {
    const config = profileLayerConfig(layerId);
    if (!config) return false;
    return grantsEdition(config["edition"], kind);
}
