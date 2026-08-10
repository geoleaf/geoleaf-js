/**
 * @file b60-notifications-mounted.test.js
 * @description Test de non-régression — `GeoLeaf.UI.Notifications` et les six raccourcis
 * `UI.show*` sont RÉELLEMENT montés après le boot.
 *
 * Pourquoi ce test existe (B-60, 29/07/2026)
 * ------------------------------------------
 * Ces sept membres étaient **déclarés dans `global.d.ts`** — donc visibles de tout intégrateur
 * compilant contre les types publiés — **enseignés dans deux documents du tarball npm**, et
 * **jamais montés**. Le code qui les construisait existait pourtant, complet, dans
 * `kernel/ui/ui-api.ts` : il vivait derrière un `if (_g.GeoLeaf._UINotifications)` évalué au
 * **corps de module**, alors que l'unique écrivain de `_UINotifications` est l'installeur de
 * `toast-renderer`, appelé **au boot**. La condition était donc toujours fausse.
 *
 * ⚠️ **Ce qui a rendu le défaut invisible si longtemps est le bloc VOISIN.** `ui-api.ts` portait le
 * même piège sur les méthodes de thème — et celui-là avait été rattrapé dans `globals.ui.ts`, avec
 * un commentaire qui diagnostiquait précisément le mécanisme. `UI.applyTheme` fonctionnait donc,
 * ce qui ne laissait rien soupçonner du jumeau resté mort douze lignes plus bas.
 *
 * ## Ce que ce test vérifie, et pourquoi dans cet ordre
 *
 *  1. l'état de départ (rien monté) — sans lui, un test qui passerait sur un namespace déjà
 *     peuplé par un autre fichier ne prouverait rien ;
 *  2. le montage APRÈS `setupUIKernel()`, **sans écrivain de `_UINotifications`** — c'est le cas
 *     qui distingue un montage réel d'une simple ré-exposition de la capacité : la délégation est
 *     paresseuse, donc les membres doivent exister même quand la capacité est absente du build,
 *     et dégrader en no-op plutôt que jeter ;
 *  3. la délégation effective quand la capacité est là.
 *
 * Le point 2 est le cœur : c'est lui qui échouait, et c'est lui qu'un futur refactor casserait.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { setupUIKernel } from "../../src/globals/globals.ui.js";

describe("B-60 — les 7 membres de notification existent après le boot", () => {
    beforeEach(() => {
        globalThis.GeoLeaf = { UI: {} };
    });

    it("ne les monte PAS avant setupUIKernel (état de départ)", () => {
        expect(globalThis.GeoLeaf.UI.Notifications).toBeUndefined();
    });

    it("les monte tous après setupUIKernel, MÊME sans écrivain de _UINotifications", () => {
        setupUIKernel();
        const ui = globalThis.GeoLeaf.UI;
        for (const k of [
            "Notifications",
            "showNotification",
            "showSuccess",
            "showError",
            "showWarning",
            "showInfo",
            "clearNotifications",
        ]) {
            expect(ui[k], `GeoLeaf.UI.${k} absent`).toBeDefined();
        }
        // Délégation paresseuse : sans capacité, l'appel dégrade en no-op au lieu de jeter.
        expect(() => ui.showInfo("x")).not.toThrow();
        expect(ui.showInfo("x")).toBeUndefined();
    });

    it("délègue réellement quand la capacité est là", () => {
        setupUIKernel();
        const seen = [];
        globalThis.GeoLeaf._UINotifications = {
            info: (m) => {
                seen.push(m);
                return "ok";
            },
        };
        expect(globalThis.GeoLeaf.UI.showInfo("hello")).toBe("ok");
        expect(seen).toEqual(["hello"]);
    });
});
