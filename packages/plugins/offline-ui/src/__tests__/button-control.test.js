/**
 * Unit tests — `ui/cache-button/button-control.ts`, real coverage.
 *
 * This module now only CAPTURES the real map at `map:ready`. We cover `init`'s
 * three outcomes (map absent, button disabled by config, nominal capture) and
 * `getMap`.
 */
import { describe, test, expect } from "vitest";

import { ButtonControl } from "../ui/cache-button/button-control.js";

describe("ButtonControl.init", () => {
    test("carte absente → null", () => {
        expect(ButtonControl.init(null, {})).toBeNull();
    });

    // Contract change of 24/08/2026: the key no longer cuts the CAPTURE — the
    // coupling made the modal mute behind a visible button. Capture is
    // unconditional; button visibility belongs to the slot alone.
    test("la clé ne coupe plus la capture (showCacheButton:false capture quand même)", () => {
        const map = { id: "map" };
        expect(ButtonControl.init(map, { ui: { showCacheButton: false } })).toBe(map);
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
