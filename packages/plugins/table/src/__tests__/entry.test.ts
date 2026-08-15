/**
 * @geoleaf-plugins/table — surface publique de `buildPublicApi()`.
 *
 * 🛑 **Ce fichier est le SEUL filet de cette surface, et c'est une propriété mesurée.**
 * `Table` n'est pas dans `EXPECTED_FACADE_KEYS` (`scripts/lib/namespace-surface.mjs`) — c'est
 * un plugin, absent d'un boot cœur, donc le golden master post-boot ne le voit pas. Et
 * `CONSUMER-CONTRACT/CC-03`, qui saurait le lire, dérive son périmètre d'un manifeste qui vit
 * HORS de ce dépôt : sur un clone sans `GEOLEAF_CONSUMERS` il saute en exit 0.
 *
 * ⚠️ Il n'assertait qu'`api.open` — un membre pouvait disparaître sans que rien ne rougisse.
 * La liste ci-dessous est écrite à la MAIN, délibérément : ce n'est pas un instantané, donc
 * `vitest -u` ne peut pas tamponner une régression de surface.
 */
import { describe, it, expect, afterEach } from "vitest";
import { buildPublicApi } from "../public-api.js";
import { tableState } from "../table-state.js";

/** Les 15 membres publiés. Retirer une ligne d'ici est un acte, pas un effet de bord. */
const EXPECTED_MEMBERS = [
    "show",
    "hide",
    "toggle",
    "open",
    "isOpen",
    "setLayer",
    "refresh",
    "sortByField",
    "setSelection",
    "getSelectedIds",
    "clearSelection",
    "zoomToSelection",
    "highlightSelection",
    "exportSelection",
    "exportLayer",
] as const;

afterEach(() => {
    tableState._container = null;
    tableState._isVisible = false;
    tableState._map = null;
});

describe("@geoleaf-plugins/table public API", () => {
    it("expose exactement les membres documentés, tous appelables", () => {
        const api = buildPublicApi();

        expect(Object.keys(api).sort()).toEqual([...EXPECTED_MEMBERS].sort());
        for (const name of EXPECTED_MEMBERS) {
            expect(typeof api[name], `\`${name}\` doit rester une fonction`).toBe("function");
        }
    });

    it("isOpen() suit show() et hide()", () => {
        const api = buildPublicApi();
        tableState._container = document.createElement("div");

        expect(api.isOpen()).toBe(false);
        api.show();
        expect(api.isOpen()).toBe(true);
        api.hide();
        expect(api.isOpen()).toBe(false);
    });

    it("🛑 isOpen() rend le contournement de B-71 possible — `open()` BASCULE", () => {
        const api = buildPublicApi();
        tableState._container = document.createElement("div");

        // Le défaut lui-même, éprouvé plutôt que cité : deux `open()` referment.
        api.open();
        expect(api.isOpen()).toBe(true);
        api.open();
        expect(api.isOpen(), "B-71 : `open()` est un alias de `toggle()`").toBe(false);

        // Le contournement que `isOpen()` rend possible, et qui n'existait pas avant elle.
        if (!api.isOpen()) api.open();
        if (!api.isOpen()) api.open();
        expect(api.isOpen()).toBe(true);
    });
});
