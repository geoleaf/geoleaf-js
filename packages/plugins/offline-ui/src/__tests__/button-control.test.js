/**
 * Unit tests — `ui/cache-button/button-control.ts`, couverture réelle (R.31).
 *
 * Depuis S2, ce module ne fait plus que CAPTURER la vraie carte à `map:ready`. On couvre
 * les trois issues d'`init` (carte absente, bouton désactivé par config, capture nominale)
 * et `getMap`.
 */
import { describe, test, expect } from "vitest";

import { ButtonControl } from "../ui/cache-button/button-control.js";

describe("ButtonControl.init", () => {
    test("carte absente → null", () => {
        expect(ButtonControl.init(null, {})).toBeNull();
    });

    test("bouton désactivé par config (showCacheButton:false) → null", () => {
        expect(ButtonControl.init({ id: "map" }, { ui: { showCacheButton: false } })).toBeNull();
    });

    test("carte présente + config par défaut → capture et rend la carte", () => {
        const map = { id: "real-map" };
        expect(ButtonControl.init(map, {})).toBe(map);
        expect(ButtonControl.getMap()).toBe(map);
    });

    test("config sans clé ui → bouton actif par défaut", () => {
        const map = { id: "m2" };
        expect(ButtonControl.init(map, { other: 1 })).toBe(map);
    });
});
