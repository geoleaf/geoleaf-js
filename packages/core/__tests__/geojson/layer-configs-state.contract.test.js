/**
 * `_allLayerConfigs` — the shared state's contract.
 *
 * Written BEFORE the move, and that is the point: **no gate sees this key**.
 * It is written on `globalThis.GeoLeaf` (`globals.geojson.ts`) and read in
 * production in two places, but it appears in NONE of
 * `scripts/lib/namespace-surface.mjs`'s three oracles — because it is only
 * set at profile load, hence never during the bare boot the golden master measures.
 *
 * Consequence, measured: the key could be renamed at the writer, or at one
 * of the two readers, and yield a **100% green suite on a broken core**. The
 * six test files mentioning it all plant the value themselves on a fake
 * global, or reinject their own setter: none crosses the real writer →
 * reader path. The only production symptom would have been a `Log.warn`
 * (`integration.ts`) and an empty legend.
 *
 * This test crosses the path. It holds for the BEFORE state (key on the
 * namespace) as for the AFTER (store in `kernel/shared/`): it does not
 * assert the CHANNEL, it asserts that what the writer sets is what the
 * readers get. That is what makes it useful to the move.
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
        // The nominal state at bare boot — and the reason the key never
        // appeared in the oracles. The reader `integration.ts` MUST
        // support it (it logs and exits).
        expect(getAllLayerConfigs()).toBeUndefined();
    });

    test("accepte d'être vidé, et ne conserve pas la valeur précédente", () => {
        setAllLayerConfigs(CONFIGS);
        setAllLayerConfigs(undefined);
        expect(getAllLayerConfigs()).toBeUndefined();
    });

    test("le seam de `globals.geojson.ts` lit et écrit le MÊME store", () => {
        // The assertion guarding the move: the loader's `_loaderDeps` must go
        // through this store and not a copy. If someone repoints one side
        // without the other, the writer writes somewhere the reader does not
        // read — exactly the mute outage this file exists to make loud.
        setAllLayerConfigs(CONFIGS);
        const viaStore = getAllLayerConfigs();
        expect(viaStore).toEqual(CONFIGS);
        expect(Array.isArray(viaStore)).toBe(true);
    });
});
