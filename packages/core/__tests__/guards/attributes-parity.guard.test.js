/**
 * Garde de parité du contrat attributaire — tâche 2.6 de `roadmap_collecte-terrain-offline`.
 *
 * Le contrat attributaire est déclaré à TROIS endroits, et chacun a une raison
 * d'exister séparément :
 *
 *   1. `contracts/attributes.contract.ts` — les types, ce que TypeScript refuse ;
 *   2. `profiles/schemas/layer-config.schema.json` — ce que `validate:profiles`
 *      refuse au build, y compris pour un profil écrit à la main hors du dépôt ;
 *   3. `capabilities/feature-info/render/widget-dispatch.ts` — ce que le moteur
 *      sait réellement peindre.
 *
 * ⚠️ Rien ne les confrontait. Mesuré au pré-vol du Sprint 2 : 33 clés d'options
 * d'un côté, 33 de l'autre, **zéro écart** — et aucune gate pour l'empêcher de
 * dériver. Les « quatre gardes vues rougir » du Sprint 1 étaient des vérifications
 * MANUELLES faites pendant l'implémentation, pas des tests permanents.
 *
 * ⚠️ C'est un TEST et non un script de `scripts/` : `verify-repo-hygiene` impose une
 * liste blanche à tout `.cjs`/`.mjs` de ce répertoire, et cette confrontation n'a
 * aucune raison d'y entrer.
 *
 * 🛑 **Et c'est cette gate qui porte la décision A11′**, pas la liste décroissante de
 * `check-orphan-exports`. Celle-ci recense des EXPORTS : `AttributeWidget` y est une
 * seule entrée pour l'union entière, donc un widget déclaré que rien ne rend n'y
 * apparaît jamais. Les trois widgets muets (`date`, `url`, `email`) lui étaient
 * invisibles depuis sa pose. La liste d'exemptions ci-dessous est VIDE, et une
 * entrée ne s'y ouvre qu'avec un motif nommé.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RENDERED_WIDGETS } from "../../src/capabilities/feature-info/render/widget-dispatch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../../../..");
const CONTRACT = resolve(REPO, "packages/core/src/contracts/attributes.contract.ts");
const SCHEMA = resolve(REPO, "profiles/schemas/layer-config.schema.json");

/**
 * Widgets déclarés au contrat que le moteur ne rend PAS encore.
 *
 * ⚠️ Doit rester vide. Une entrée s'écrit avec son motif et la tâche qui la retire —
 * jamais « en attendant ». Décision A11′.
 */
const UNRENDERED_EXEMPTIONS = Object.freeze([]);

/** Lit les membres d'une union de littéraux de chaîne du contrat. */
function unionMembers(source, typeName) {
    const start = source.indexOf(`export type ${typeName} =`);
    if (start === -1) throw new Error(`Type introuvable dans le contrat : ${typeName}`);
    const end = source.indexOf(";", start);
    return [...source.slice(start, end).matchAll(/"([a-zA-Z[\]-]+)"/g)].map((m) => m[1]).sort();
}

/** Lit les clés d'une interface du contrat, à plat. */
function interfaceKeys(source, interfaceName) {
    const start = source.indexOf(`export interface ${interfaceName} {`);
    if (start === -1) throw new Error(`Interface introuvable : ${interfaceName}`);
    const end = source.indexOf("\n}", start);
    return [...source.slice(start, end).matchAll(/^\s{4}(?:readonly\s+)?([a-zA-Z]+)\??:/gm)]
        .map((m) => m[1])
        .sort();
}

const contractSource = readFileSync(CONTRACT, "utf8");
const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));

describe("Parité du contrat attributaire (ATTR-PARITY)", () => {
    it("ATTR-01 — AttributeWidget (TS) ≡ l'enum widget du schéma JSON", () => {
        const contractWidgets = unionMembers(contractSource, "AttributeWidget");
        const schemaWidgets = [...schema.definitions.attributeField.properties.widget.enum].sort();

        expect(contractWidgets.length).toBeGreaterThan(20);
        expect(schemaWidgets, "widgets du schéma ≠ widgets du contrat").toEqual(contractWidgets);
    });

    it("ATTR-02 — AttributeSurface (TS) ≡ l'enum des surfaces du schéma", () => {
        const contractSurfaces = unionMembers(contractSource, "AttributeSurface");
        const schemaSurfaces = [
            ...schema.definitions.attributeField.properties.display.properties.surfaces.items.enum,
        ].sort();
        expect(schemaSurfaces).toEqual(contractSurfaces);
    });

    it("ATTR-03 — AttributePrimitive (TS) ≡ l'enum primitive du schéma", () => {
        const contractPrimitives = unionMembers(contractSource, "AttributePrimitive");
        const schemaPrimitives = [
            ...schema.definitions.attributeField.properties.primitive.enum,
        ].sort();
        expect(schemaPrimitives).toEqual(contractPrimitives);
    });

    it("ATTR-04 — AttributeEmphasis (TS) ≡ l'enum emphasis du schéma", () => {
        const contractEmphasis = unionMembers(contractSource, "AttributeEmphasis");
        const schemaEmphasis = [
            ...schema.definitions.attributeField.properties.display.properties.presentation
                .properties.emphasis.enum,
        ].sort();
        expect(schemaEmphasis).toEqual(contractEmphasis);
    });

    it("ATTR-05 — les clés de presentation (TS) ≡ celles du schéma", () => {
        const contractKeys = interfaceKeys(contractSource, "AttributeDisplayPresentation");
        const schemaKeys = Object.keys(
            schema.definitions.attributeField.properties.display.properties.presentation.properties
        ).sort();
        expect(schemaKeys).toEqual(contractKeys);
    });

    it("ATTR-06 — l'union des clés d'options (TS) ≡ attributeOptions du schéma", () => {
        // Chaque interface `*Options` du contrat, aplatie — c'est l'ensemble que le
        // schéma déclare à plat de son côté.
        //
        // ⚠️ `AttributeWidgetOptions` est exclue, et l'oubli n'était pas théorique :
        // c'est la table widget → options, donc ses clés sont les 24 WIDGETS, pas des
        // clés d'options. Sans l'exclusion, cette assertion comparait 60 entrées à 36
        // et rougissait sur son propre biais. 7ᵉ biais d'instrument de la session, et
        // le corollaire « le pré-vol peut porter la cécité qu'il mesure » vaut aussi
        // pour la gate qui mesure la parité.
        const optionInterfaces = [
            ...contractSource.matchAll(/export interface ([A-Za-z]*Options) \{/g),
        ]
            .map((m) => m[1])
            .filter((name) => name !== "AttributeWidgetOptions");
        const contractKeys = [
            ...new Set(optionInterfaces.flatMap((name) => interfaceKeys(contractSource, name))),
        ].sort();
        const schemaKeys = Object.keys(schema.definitions.attributeOptions.properties).sort();

        expect(contractKeys.length).toBeGreaterThan(30);
        expect(schemaKeys, "clés d'options du schéma ≠ celles du contrat").toEqual(contractKeys);
    });

    it("ATTR-07 — le moteur rend TOUS les widgets du contrat (A11′)", () => {
        const contractWidgets = unionMembers(contractSource, "AttributeWidget");
        const missing = contractWidgets.filter(
            (w) => !RENDERED_WIDGETS.includes(w) && !UNRENDERED_EXEMPTIONS.includes(w)
        );
        expect(
            missing,
            `Widget(s) déclaré(s) au contrat et rendu(s) par AUCUNE branche du moteur.\n` +
                `C'est exactement le piège LATENT que FE-14 a coûté : rien ne rougit tant ` +
                `qu'aucun profil ne les emploie, puis le champ disparaît en silence.\n` +
                `Soit le widget se code, soit il entre dans UNRENDERED_EXEMPTIONS avec son motif.`
        ).toEqual([]);
    });

    it("ATTR-08 — le moteur ne rend AUCUN widget hors contrat", () => {
        const contractWidgets = unionMembers(contractSource, "AttributeWidget");
        const extra = RENDERED_WIDGETS.filter((w) => !contractWidgets.includes(w));
        expect(
            extra,
            `Widget(s) rendu(s) par le moteur et absent(s) du contrat — donc REFUSÉ(s) par ` +
                `validate:profiles. C'est le sens inverse de FE-14, celui qui a produit 8 types ` +
                `« rendus jamais déclarés » et bien utilisés par les profils.`
        ).toEqual([]);
    });

    it("ATTR-09 — la liste d'exemptions ne peut que rétrécir (A11′)", () => {
        // Une exemption dont le widget est rendu depuis est un fantôme : elle
        // laisserait croire qu'un trou subsiste et masquerait le prochain.
        const ghosts = UNRENDERED_EXEMPTIONS.filter((w) => RENDERED_WIDGETS.includes(w));
        expect(ghosts, "Exemption(s) fantôme(s) — le widget est rendu, l'entrée sort").toEqual([]);
    });

    it("ATTR-10 — AttributeCaptureWidget (TS) ≡ l'enum edit.widget du schéma (7.2)", () => {
        // Depuis 7.2 le schéma porte DEUX vocabulaires de widget : celui de lecture
        // (ATTR-01 ci-dessus) et celui de capture. Sans cette assertion, le second
        // pourrait dériver du premier sans que rien ne le voie — et c'est le vocabulaire
        // qui décide quel composant `field-renderer` reçoit la saisie.
        const contractWidgets = unionMembers(contractSource, "AttributeWidget");
        const displayOnly = unionMembers(contractSource, "AttributeDisplayOnlyWidget");
        const captureWidgets = contractWidgets.filter((w) => !displayOnly.includes(w)).sort();
        const schemaCapture = [
            ...schema.definitions.attributeField.properties.edit.properties.widget.enum,
        ].sort();

        expect(displayOnly.length).toBeGreaterThan(0);
        expect(captureWidgets.length).toBe(contractWidgets.length - displayOnly.length);
        expect(schemaCapture, "widgets de capture du schéma ≠ ceux du contrat").toEqual(
            captureWidgets
        );
    });

    it("ATTR-11 — tout widget de capture a un composant field-renderer enregistré", () => {
        // 🛑 C'est l'assertion qui règle `reviews` pour de bon. Le contrat a porté
        // pendant tout le Sprint 6 un commentaire affirmant que Q6 nommait `reviews`
        // « display-only » alors que `field-renderer` l'enregistre — une contradiction
        // qui a survécu parce que RIEN ne confrontait les deux listes. Elle est tranchée
        // à 7.2 en faveur du code ; cette garde est ce qui empêche la prochaine de durer
        // aussi longtemps.
        //
        // ⚠️ Le catalogue est lu dans la SOURCE plutôt qu'importé : `field-renderer` est
        // une lib publiée, et la garde doit rougir sur l'état du dépôt, pas sur celui
        // d'un `dist/` éventuellement périmé.
        const builtins = readFileSync(
            resolve(REPO, "packages/libs/field-renderer/src/builtins.ts"),
            "utf8"
        );
        const registered = [...builtins.matchAll(/from "\.\/types\/([a-z-]+)\.js"/g)].map(
            (m) => m[1]
        );
        const contractWidgets = unionMembers(contractSource, "AttributeWidget");
        const displayOnly = unionMembers(contractSource, "AttributeDisplayOnlyWidget");

        // Anti-gate-vide : une extraction cassée sortirait verte en ne comparant rien.
        expect(registered.length).toBeGreaterThan(20);

        const uncapturable = contractWidgets
            .filter((w) => !displayOnly.includes(w))
            .filter((w) => !registered.includes(w));
        expect(
            uncapturable,
            `Widget(s) déclaré(s) capturable(s) mais sans composant field-renderer : la ` +
                `saisie tomberait dans le repli SILENCIEUX \`?? ComponentRegistry.get("text")\` ` +
                `du bridge. Soit le composant s'écrit, soit le widget entre dans ` +
                `AttributeDisplayOnlyWidget avec son motif.`
        ).toEqual([]);

        const wronglyDisplayOnly = displayOnly.filter((w) => registered.includes(w));
        expect(
            wronglyDisplayOnly,
            `Widget(s) dit(s) « display-only » alors que field-renderer enregistre leur ` +
                `composant — c'est exactement la contradiction \`reviews\` que 7.2 a tranchée.`
        ).toEqual([]);
    });
});
