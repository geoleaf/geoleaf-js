/**
 * Unit — `layerGeometry`, la résolution UNIQUE de l'alias `geometry` / `geometryType`.
 *
 * 🛑 POURQUOI CE HELPER EXISTE. Le schéma pose les deux clés comme le même champ
 * (`profiles/schemas/layer-config.schema.json:42` — « Root-level alias of `geometry` […] do
 * NOT migrate (ANO-007) »), mais le dépôt le lisait de **sept** façons : 3 sites résolvaient
 * l'alias à la main — avec des REPLIS différents, `"point"` pour la légende et `"polygon"`
 * pour les tuiles vectorielles — et 4 lisaient `geometryType` seul, c'est-à-dire la clé
 * qu'**aucune** des 24 configs du dépôt ne déclare sans l'autre.
 *
 * Ces tests fixent le contrat que les sept sites partagent désormais.
 */
import { describe, it, expect } from "vitest";
import { layerGeometry } from "../../src/kernel/config/layer-geometry.js";

describe("layerGeometry — les deux orthographes du même champ", () => {
    it("lit `geometryType`", () => {
        expect(layerGeometry({ geometryType: "point" })).toBe("point");
    });

    it("lit `geometry` — la forme que 18 des 24 configs du dépôt utilisent SEULE", () => {
        expect(layerGeometry({ geometry: "polygon" })).toBe("polygon");
    });

    it("préfère `geometryType` quand les deux sont là", () => {
        // ⚠️ Départage théorique : mesuré le 07/08/2026, **aucune** des 6 configs qui
        // déclarent les deux ne les déclare différents. Un désaccord est une erreur de
        // profil et relève de `validate:profiles`, pas d'un arbitrage silencieux ici.
        expect(layerGeometry({ geometry: "polygon", geometryType: "point" })).toBe("point");
    });
});

describe("layerGeometry — le repli est un PARAMÈTRE, pas une constante", () => {
    it("rend `null` par défaut quand aucune des deux clés n'est déclarée", () => {
        expect(layerGeometry({ label: "sans géométrie" })).toBeNull();
    });

    it("rend le repli fourni — c'est ce qui laisse à chaque site le sien", () => {
        // La légende replie sur "point", les tuiles vectorielles sur "polygon". Collapser
        // les deux sur une valeur unique aurait changé le comportement de deux sous-systèmes.
        expect(layerGeometry({}, "point")).toBe("point");
        expect(layerGeometry({}, "polygon")).toBe("polygon");
    });

    it("ne rend jamais une chaîne VIDE — elle traverse vers l'autre clé, puis vers le repli", () => {
        // `legend.ts` en dépend : son `layerInfo.geometryType` est initialisé à `""`, et un
        // `??` s'y serait arrêté. Le helper doit se comporter comme le `||` qu'il remplace.
        expect(layerGeometry({ geometryType: "", geometry: "line" })).toBe("line");
        expect(layerGeometry({ geometryType: "", geometry: "" }, "point")).toBe("point");
    });
});

describe("layerGeometry — entrées hostiles", () => {
    it("tolère `null`, `undefined` et un non-objet", () => {
        expect(layerGeometry(null)).toBeNull();
        expect(layerGeometry(undefined)).toBeNull();
        expect(layerGeometry("point" as unknown as { geometry?: unknown })).toBeNull();
        expect(layerGeometry(null, "polygon")).toBe("polygon");
    });

    it("ignore une valeur non-textuelle plutôt que de la propager", () => {
        expect(layerGeometry({ geometryType: 42 })).toBeNull();
        expect(layerGeometry({ geometryType: 42, geometry: "point" })).toBe("point");
    });
});
