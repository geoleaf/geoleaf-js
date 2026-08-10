/**
 * @file feature-info-structure.guard.test.js
 * @description Test-garde structurel de la capacité `feature-info` (backlog R.20).
 *
 * ## Pourquoi ce garde existe
 *
 * Le reclassement SR0 (04/07/2026) a fait passer `feature-info` de plugin externe à
 * capacité in-core. Les **2 specs qui verrouillaient sa liste de fichiers** ont été
 * retirées de `extracted-features.guard.test.js` à cette occasion — à juste titre :
 * ce garde-là interdit à une feature EXTRAITE de laisser un résidu dans le core, et
 * `feature-info` est désormais délibérément DANS le core. Le contrat ne s'appliquait
 * plus.
 *
 * Mais rien n'a pris le relais. C'est ce retrait qui a rendu le renommage de
 * CAPACITÉS S2 indolore, et c'est lui qui laisse la capacité sans filet depuis.
 *
 * ## Ce que ce garde vérifie — et ce qu'il ne vérifie PAS
 *
 * Le miroir naïf du garde retiré serait « aucune mention de feature-info hors de son
 * répertoire ». Mesuré au 24/07 : **33 fichiers du core en portent une, toutes
 * légitimes** (module de boot, façade `geoleaf.featureinfo.ts`, contrats, i18n, CSS,
 * et toute la capacité `taxonomy` qui la consomme). Un garde par token produirait 33
 * faux positifs le jour de sa pose — donc ce n'est pas l'invariant à écrire.
 *
 * Les trois invariants ci-dessous sont ceux qui se cassent en silence :
 *
 *   FI-01  Les fichiers STRUCTURANTS existent. Pas un inventaire exhaustif (il
 *          rougirait à chaque ajout légitime) : les fichiers dont la disparition ou
 *          le déplacement change l'architecture de la capacité.
 *   FI-02  La façade reste une façade (INV-FACADE). `public-api.ts` délègue aux
 *          surfaces ; s'il se met à importer `render/*` directement, il a absorbé de
 *          la logique de présentation — exactement la dérive que la séparation
 *          façade/implémentation interdit.
 *   FI-03  La capacité est bien montée sur le namespace via sa façade.
 *
 * La surface publique à 5 méthodes est déjà couverte par
 * `__tests__/capabilities/feature-info/public-api.test.js` — non redupliquée ici.
 *
 * ⚠️ Écrit en ESM et non en CJS comme les 3 autres gardes : le paquet est
 * `"type": "module"`, et les fichiers `.js` en CJS sont précisément ce qui maintient
 * la dépendance à tsx (mesuré en R.22, voir `ensure-tsx-node-options.mjs`). Ne pas
 * réintroduire de `require()` ici.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_SRC = resolve(__dirname, "../../src");
const CAP = resolve(CORE_SRC, "capabilities/feature-info");

/**
 * Fichiers structurants de la capacité. Chacun porte une part de l'architecture :
 * retirer ou déplacer l'un d'eux est une décision, pas un détail.
 */
const STRUCTURAL_FILES = [
    // Façade et contrat
    "public-api.ts",
    "types.ts",
    "config.ts",
    // Cycle de vie et enregistrement
    "install.ts",
    "lifecycle.ts",
    "feature-info-capability.ts",
    // Les 3 surfaces — c'est la promesse de l'API publique
    "surfaces/popup.ts",
    "surfaces/sidepanel.ts",
    "surfaces/tooltip.ts",
    // Résolution de la liaison par couche
    "convert.ts",
    "resolve.ts",
];

describe("feature-info — garde structurelle (R.20, filet repris après le retrait SR0)", () => {
    it("FI-01 — les fichiers structurants de la capacité existent", () => {
        const missing = STRUCTURAL_FILES.filter((rel) => !existsSync(resolve(CAP, rel)));
        expect(
            missing,
            `Fichier(s) structurant(s) absent(s) de capabilities/feature-info/.\n` +
                `Si le déplacement est voulu, mettre à jour STRUCTURAL_FILES dans ce garde ` +
                `— c'est le point : la liste ne bouge que sciemment.`
        ).toEqual([]);
    });

    it("FI-02 — la façade délègue aux surfaces et n'importe pas render/ directement", () => {
        const source = readFileSync(resolve(CAP, "public-api.ts"), "utf8");
        const renderImports = source
            .split("\n")
            .filter((line) => /^\s*import\s/.test(line) && /["']\.\/render\//.test(line));
        expect(
            renderImports,
            `public-api.ts importe render/ directement — la façade a absorbé de la logique ` +
                `de présentation. Elle doit passer par surfaces/.`
        ).toEqual([]);

        // Et elle délègue bien : au moins une surface importée.
        expect(source).toMatch(/from\s+["']\.\/surfaces\//);
    });

    it("FI-03 — la façade monte l'objet CONSTRUIT, pas un objet quelconque", async () => {
        const facade = resolve(CORE_SRC, "api/geoleaf.featureinfo.ts");
        expect(existsSync(facade), "api/geoleaf.featureinfo.ts est absent").toBe(true);

        // ⚠️ Première écriture de ce test : deux `toMatch` sur la SOURCE
        // (`/buildPublicApi/` et `/export const FeatureInfo/`). Prouvé non couvrant
        // par mutation — en remplaçant `buildPublicApi()` par `{}`, la ligne d'import
        // restait et les deux regex passaient toujours. Un test qui cherche un token
        // que la mutation ne retire pas ne garde rien : on importe donc le module et
        // on regarde ce qu'il monte réellement.
        const { FeatureInfo } = await import(facade);
        for (const method of ["isEnabled", "close", "openPopup", "openSidePanel", "getConfig"]) {
            expect(typeof FeatureInfo[method], `FeatureInfo.${method} n'est pas monté`).toBe(
                "function"
            );
        }
    });
});
