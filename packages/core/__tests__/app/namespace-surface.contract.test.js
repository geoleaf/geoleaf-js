/**
 * Contract of the namespace walk itself (API publique S4.1).
 *
 * `walkNamespace` is used by four consumers, one of which — `scripts/probe-boot-contract.mjs` —
 * ships it into Chromium as SOURCE TEXT (`walkNamespace.toString()` fed to `new Function`).
 * Two properties are therefore load-bearing, and neither is visible in the three surface tests
 * that consume it:
 *
 *   1. **self-sufficiency** — a single free reference (an import, a module-scope const, a
 *      helper declared outside the function) makes the transported copy throw a `ReferenceError`
 *      in the page, at a point where the failure reads as "the probe found no surface";
 *   2. **accessors are never invoked** — reading `GeoLeaf._APIController` builds an
 *      `APIController`, whose `init()` re-enters `_scanExistingModules()`, which re-reads
 *      `_APIController` mid-construction. That re-entrancy blew the stack in a browser for
 *      real. A measurement that mutates what it measures is not a measurement.
 *
 * Both are asserted here because they cannot be asserted where they matter: the browser probe
 * is not part of `ci:local` (it needs a served deployment), and the two Vitest consumers walk a
 * namespace whose only accessor happens to be harmless under Node.
 */
"use strict";

import { describe, test, expect, vi } from "vitest";
import {
    walkNamespace,
    diffSurface,
    IMPORT_SURFACE,
    IMPORT_SURFACE_MIN,
    EXPECTED_FACADE_KEYS,
    DEPTH2_FACADES,
} from "../../../../scripts/lib/namespace-surface.mjs";

describe("walkNamespace — contrat de la marche", () => {
    test("est auto-suffisante : reconstructible depuis sa seule source", () => {
        // Exactement ce que fait `page.addInitScript(..., walkNamespace.toString())`.
        // `no-new-func` est désactivé ci-dessous parce que c'est LE mécanisme sous test : la
        // sonde Chromium reconstruit la marche depuis sa source, et c'est cette reconstruction
        // qui échoue sur une référence libre. L'interdire ici reviendrait à ne pas tester ce
        // que la sonde fait réellement.
        // eslint-disable-next-line no-new-func
        const transported = new Function("return (" + walkNamespace.toString() + ")")();
        expect(transported({ a: 1 }).keys).toEqual(["a"]);
        // Une référence libre ferait échouer la ligne ci-dessus sur ReferenceError, ici et
        // seulement ici — dans la page, elle se lirait « la sonde n'a rien capturé ».
    });

    test("n'invoque JAMAIS un accesseur, ni à la profondeur 1 ni à la 2", () => {
        const boom = vi.fn(() => {
            throw new Error("accesseur invoqué pendant la mesure");
        });
        const inner = {};
        Object.defineProperty(inner, "nested", { get: boom, enumerable: true });

        const root = { plain: {}, fn() {} };
        Object.defineProperty(root, "trap", { get: boom, enumerable: true });
        Object.defineProperty(root, "deep", { value: inner, enumerable: true });

        const r = walkNamespace(root, { descend: ["deep", "trap"] });

        expect(boom).not.toHaveBeenCalled();
        expect(r.kinds.trap).toBe("getter");
        // Un accesseur est enregistré par son NOM et n'est jamais descendu…
        expect(r.members.trap).toBeUndefined();
        // …et un accesseur RENCONTRÉ en profondeur 2 est nommé sans être lu.
        expect(r.members.deep).toContain("nested");
    });

    test("ne descend que sur demande explicite", () => {
        const root = { Events: { on() {}, off() {} } };
        expect(walkNamespace(root).members).toEqual({});
        expect(walkNamespace(root, { descend: ["Events"] }).members.Events).toEqual(["off", "on"]);
    });

    test("écarte les membres `_` et `constructor` à la profondeur 2", () => {
        class Facade {
            method() {}
            _private() {}
        }
        const r = walkNamespace({ F: new Facade() }, { descend: ["F"] });
        expect(r.members.F).toContain("method");
        expect(r.members.F).not.toContain("_private");
        expect(r.members.F).not.toContain("constructor");
    });
});

describe("diffSurface — le diff nommé", () => {
    test("nomme ce qui manque et ce qui apparaît", () => {
        expect(diffSurface(["a", "b", "c"], ["a", "c", "d"])).toEqual({
            missing: ["b"],
            extra: ["d"],
        });
    });
});

describe("les trois tiers", () => {
    test("MIN ⊆ IMPORT ⊆ POST", () => {
        // Doublon délibéré de l'assertion du tier artefact : celle-ci tourne dans le run
        // `npm test` standard, celle-là sous `vitest.bundle.config.ts`. La dérive `requireMap`
        // a duré onze jours faute d'un seul instrument qui la voie sans navigateur.
        expect(IMPORT_SURFACE_MIN.filter((k) => !IMPORT_SURFACE.includes(k))).toEqual([]);
        expect(IMPORT_SURFACE.filter((k) => !EXPECTED_FACADE_KEYS.includes(k))).toEqual([]);
    });

    test("aucune liste n'est vide ni dédoublonnable — plancher de non-vacuité", () => {
        for (const [nom, liste] of [
            ["IMPORT_SURFACE", IMPORT_SURFACE],
            ["IMPORT_SURFACE_MIN", IMPORT_SURFACE_MIN],
            ["EXPECTED_FACADE_KEYS", EXPECTED_FACADE_KEYS],
        ]) {
            expect(liste.length, `${nom} est vide`).toBeGreaterThan(20);
            expect(new Set(liste).size, `${nom} contient un doublon`).toBe(liste.length);
        }
    });

    test("les façades de profondeur 2 existent toutes dans l'oracle", () => {
        // Sinon on descendrait sur un nom qui n'est plus monté, et la mesure serait vide
        // sans que rien ne le dise.
        expect(DEPTH2_FACADES.filter((k) => !EXPECTED_FACADE_KEYS.includes(k))).toEqual([]);
    });

    test("`registry`, `_registry` et `_app` restent HORS de la profondeur 2", () => {
        // `GeoLeaf.registry` et `GeoLeaf._registry` sont la même instance de `ModuleRegistry`,
        // dont les champs `private` sont effacés à l'exécution : les figer rendrait l'oracle
        // rouge au premier refactor interne, et la réaction humaine à ça est de tamponner la
        // baseline — ce qui tue l'oracle.
        for (const interdit of ["registry", "_registry", "_app"]) {
            expect(DEPTH2_FACADES).not.toContain(interdit);
        }
    });
});
