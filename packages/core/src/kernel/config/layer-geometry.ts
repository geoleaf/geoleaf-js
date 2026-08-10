/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview Resolves the geometry a layer configuration declares, in either spelling.
 *
 * 🛑 POURQUOI CE FICHIER EXISTE — `geometry` et `geometryType` sont LE MÊME CHAMP.
 *
 * Le schéma le dit explicitement (`profiles/schemas/layer-config.schema.json:42`) :
 * « Root-level **alias of `geometry`**. Canonical form READ BY THE CODE — do NOT migrate
 * (ANO-007) ». Les deux portent le même `enum`. L'arbitrage est donc **déjà pris** : on ne
 * migre pas les profils, et le code lit les deux.
 *
 * Il ne le faisait pas. Mesuré le 07/08/2026 sur les **24** configs de couche des 3 profils :
 *
 * | Ce que la config déclare | Nombre |
 * |---|---|
 * | `geometry` seul | **18** |
 * | les deux | 6 |
 * | `geometryType` seul | **0** |
 *
 * Et sur les **7** sites qui lisent ce champ, **3** résolvaient l'alias à la main
 * (`legend.ts`, les deux `vector-tiles`) et **4** lisaient `geometryType` seul — c'est-à-dire
 * la clé qu'**aucune** config ne porte sans l'autre. Conséquences mesurées : 38 des 42 lignes
 * du sélecteur hors-ligne rendaient `-` (**B-161**), et `_acceptsGeometry` de l'éditeur
 * retombait sur « accepte TOUTE géométrie » pour une couche qui déclare la sienne — le mode
 * d'échec que son propre TSDoc décrit comme dangereux.
 *
 * ⚠️ **Les trois résolutions à la main divergeaient déjà sur leur REPLI** : `"point"` pour la
 * légende, `"polygon"` pour les tuiles vectorielles. C'est pourquoi le repli est un
 * **paramètre** ici — les collapser sur une valeur unique aurait changé le comportement de
 * deux sous-systèmes sans que rien ne le demande.
 */

/**
 * La forme minimale que ce helper lit — n'importe quelle config de couche la satisfait.
 *
 * ⚠️ NON exportée : elle n'a aucun consommateur nommé, les appelants passant leur config
 * telle quelle. L'exporter sortait en régression de `check-orphan-exports` à la pose, et la
 * mettre en ALLOWLIST aurait été s'exempter d'une gate plutôt que de l'écouter.
 */
interface LayerGeometryShape {
    geometry?: unknown;
    geometryType?: unknown;
}

/**
 * The geometry a layer configuration declares, whichever of the two aliases carries it.
 *
 * ⚠️ `geometryType` wins when both are present. They are aliases, so this only matters if a
 * profile declares them with DIFFERENT values — measured on 07/08/2026: **0 of the 6 configs
 * that declare both disagree**. Should that ever change, the disagreement is a profile error
 * and belongs to `validate:profiles`, not to a silent tie-break here.
 *
 * @param config - A layer configuration, raw from disk or normalised by the profile loader.
 * @param fallback - Returned when the config declares neither key. Defaults to `null`.
 * @returns The declared geometry (e.g. `"point"`, `"polygon"`), or `fallback`.
 * @example
 * layerGeometry({ geometryType: "point" });              // "point"
 * layerGeometry({ geometry: "polygon" });                // "polygon"
 * layerGeometry({ geometry: "line" }, "point");          // "line"
 * layerGeometry({ label: "sans géométrie" });            // null
 * layerGeometry({ label: "sans géométrie" }, "polygon"); // "polygon"
 */
export function layerGeometry<T extends string | null = null>(
    config: LayerGeometryShape | null | undefined,
    fallback: T = null as T
): string | T {
    if (!config || typeof config !== "object") return fallback;
    if (typeof config.geometryType === "string" && config.geometryType) return config.geometryType;
    if (typeof config.geometry === "string" && config.geometry) return config.geometry;
    return fallback;
}
