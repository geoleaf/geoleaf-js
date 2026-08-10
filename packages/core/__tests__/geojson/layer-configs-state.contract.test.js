/**
 * `_allLayerConfigs` — contrat de l'état partagé (API publique S4.3e).
 *
 * Écrit AVANT le déplacement, et c'est le point : **aucune gate ne voit cette clé**. Elle est
 * écrite sur `globalThis.GeoLeaf` (`globals.geojson.ts`) et lue en production à deux endroits,
 * mais elle ne figure dans AUCUN des trois oracles de `scripts/lib/namespace-surface.mjs` —
 * parce qu'elle n'est posée qu'au chargement d'un profil, donc jamais pendant le boot nu que
 * le golden master mesure.
 *
 * Conséquence, mesurée : on pouvait renommer la clé chez l'écrivain, ou chez l'un des deux
 * lecteurs, et obtenir une suite **100 % verte sur un core cassé**. Les six fichiers de test
 * qui la mentionnent plantent tous la valeur eux-mêmes sur un faux global, ou réinjectent leur
 * propre setter : aucun ne traverse le chemin réel écrivain → lecteur. Le seul symptôme en
 * production aurait été un `Log.warn` (`integration.ts:406`) et une légende vide.
 *
 * Ce test-ci traverse le chemin. Il vaut pour l'état AVANT (clé sur le namespace) comme APRÈS
 * (store dans `kernel/shared/`) : il n'asserte pas le CANAL, il asserte que ce que l'écrivain
 * pose est bien ce que les lecteurs obtiennent. C'est ce qui le rend utile au déplacement.
 */
"use strict";

import { describe, test, expect, beforeEach } from "vitest";
import "../../src/globals/globals.js";
import {
    getAllLayerConfigs,
    setAllLayerConfigs,
} from "../../src/kernel/shared/layer-configs-state.js";

const CONFIGS = [
    { id: "monuments", name: "Monuments", visible: true },
    { id: "parcs", name: "Parcs", visible: false },
];

describe("layer-configs-state — l'état partagé des configs de couches", () => {
    beforeEach(() => {
        setAllLayerConfigs(undefined);
    });

    test("ce que l'écrivain pose est ce que le lecteur obtient", () => {
        setAllLayerConfigs(CONFIGS);
        expect(getAllLayerConfigs()).toBe(CONFIGS);
    });

    test("rend `undefined` avant tout chargement de profil", () => {
        // C'est l'état nominal au boot nu — et la raison pour laquelle la clé n'a jamais figuré
        // dans les oracles. Le lecteur `integration.ts:403` DOIT le supporter (il logue et sort).
        expect(getAllLayerConfigs()).toBeUndefined();
    });

    test("accepte d'être vidé, et ne conserve pas la valeur précédente", () => {
        setAllLayerConfigs(CONFIGS);
        setAllLayerConfigs(undefined);
        expect(getAllLayerConfigs()).toBeUndefined();
    });

    test("le seam de `globals.geojson.ts` lit et écrit le MÊME store", () => {
        // L'assertion qui garde le déplacement : le `_loaderDeps` du chargeur doit passer par
        // ce store et non par une copie. Si quelqu'un repointe l'un des deux côtés sans
        // l'autre, l'écrivain écrit quelque part que le lecteur ne lit pas — exactement la
        // panne muette que ce fichier existe pour rendre bruyante.
        setAllLayerConfigs(CONFIGS);
        const viaStore = getAllLayerConfigs();
        expect(viaStore).toEqual(CONFIGS);
        expect(Array.isArray(viaStore)).toBe(true);
    });
});
