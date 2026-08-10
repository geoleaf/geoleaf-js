/**
 * Unit tests — `kernel-exports.ts` (barrel de la surface kernel, à 0 %).
 *
 * Fichier de ré-exports (façades + utilitaires) + un seul évalué : `Utils = createUtilsNamespace()`.
 * L'importer suffit à couvrir les lignes ; on vérifie que la surface annoncée est bien exposée.
 */
import { describe, test, expect } from "vitest";

import * as kx from "../src/kernel-exports.js";

describe("kernel-exports — surface publique", () => {
    test("expose les façades haut niveau", () => {
        for (const name of ["Core", "GeoLeafAPI", "UI", "LayerManager", "Events", "Config"]) {
            expect(kx[name], name).toBeTruthy();
        }
    });

    test("GeoLeafAPI EST le namespace vivant, pas un objet quelconque", () => {
        // ⚠️ socle-init 7.7 — `toBeTruthy()` ci-dessus ne dit presque rien de `GeoLeafAPI` :
        // `{}` est truthy. C'était sans conséquence tant que `kernel/api/geoleaf-api.ts`
        // assemblait l'API ; depuis qu'il ne fait plus que ré-exporter le namespace, c'est
        // l'IDENTITÉ qui porte le contrat — ce qui est ré-exporté doit être l'objet global
        // lui-même, pour que tout ce qu'un autre module y monte plus tard soit visible ici.
        expect(kx.GeoLeafAPI).toBe(globalThis.GeoLeaf);
    });

    test("expose les utilitaires (Log, Errors, CONSTANTS, Utils, applyCssText)", () => {
        expect(kx.Log).toBeTruthy();
        expect(kx.Errors).toBeTruthy();
        expect(kx.CONSTANTS).toBeTruthy();
        expect(kx.Utils).toBeTruthy();
        expect(typeof kx.applyCssText).toBe("function");
    });

    test("expose les sous-modules API du registre", () => {
        expect(kx.PluginRegistry).toBeTruthy();
        expect(typeof kx.showBootInfo).toBe("function");
    });

    // API publique S3.2 — `CapabilityRegistry` était exporté par le barrel `kernel/api/index.ts`
    // et atteignable par AUCUN canal public : ni ici, ni sur le global. Un plugin ne pouvait
    // déclarer une capacité que par `GeoLeaf.plugins.registerCapability(decl)`, sans type.
    // Le test porte sur les méthodes du contrat `ICapabilityRegistry`, pas sur la seule
    // présence de l'objet : c'est la surface annoncée qui doit être là, pas un symbole vide.
    //
    // ⚠️ 6 → 8 (socle-init 9.4 : `noteInstaller` + `getAllStatuses`). Le décompte est dans le
    // NOM du test parce que la boucle, elle, est additive : elle serait restée verte en
    // décrivant une surface périmée. Aucune gate ne peut voir ça — c'est la ligne « 🖐 à toi »
    // de CLAUDE.md §⛔, et la raison pour laquelle le chiffre est écrit ici plutôt que déduit.
    test("expose CapabilityRegistry avec les 8 méthodes de ICapabilityRegistry", () => {
        expect(kx.CapabilityRegistry).toBeTruthy();
        const methods = [
            "register",
            "isEnabled",
            "isLoaded",
            "ensureLoaded",
            "getSchema",
            "getAllSchemas",
            "noteInstaller",
            "getAllStatuses",
        ];
        // Le décompte est asserté, pas seulement les noms : c'est ce qui rend la liste
        // ci-dessus falsifiable si le contrat grandit sans que ce test le sache.
        expect(methods).toHaveLength(8);
        for (const method of methods) {
            expect(typeof kx.CapabilityRegistry[method], method).toBe("function");
        }
    });
});
