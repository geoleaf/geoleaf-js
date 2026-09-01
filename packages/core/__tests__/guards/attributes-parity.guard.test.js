/**
 * Parity guard of the attribute contract.
 *
 * The attribute contract is declared in THREE places, each with a reason to
 * exist separately:
 *
 *   1. `contracts/attributes.contract.ts` — the types, what TypeScript refuses;
 *   2. `profiles/schemas/layer-config.schema.json` — what `validate:profiles`
 *      refuses at build, including for a profile hand-written outside the repo;
 *   3. `capabilities/feature-info/render/widget-dispatch.ts` — what the
 *      engine really knows how to paint.
 *
 * ⚠️ Nothing confronted them. Measured before the guard: 33 option keys on
 * one side, 33 on the other, **zero gap** — and no gate to keep it from
 * drifting. The "four guards seen turning red" of before were MANUAL checks
 * done during implementation, not permanent tests.
 *
 * ⚠️ It is a TEST and not a `scripts/` script: `verify-repo-hygiene` imposes
 * a whitelist on every `.cjs`/`.mjs` of that directory, and this
 * confrontation has no reason to enter it.
 *
 * 🛑 **And this gate is what carries the decision**, not
 * `check-orphan-exports`'s shrinking list. That one inventories EXPORTS:
 * `AttributeWidget` is a single entry there for the whole union, so a
 * declared widget nothing renders never shows up. The three mute widgets
 * (`date`, `url`, `email`) were invisible to it since its pose. The
 * exemption list below is EMPTY, and an entry only opens with a named motive.
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
 * Widgets declared in the contract the engine does NOT render yet.
 *
 * ⚠️ Must stay empty. An entry is written with its motive and the work that
 * removes it — never "for now".
 */
const UNRENDERED_EXEMPTIONS = Object.freeze([]);

/** Reads the members of a string-literal union from the contract. */
function unionMembers(source, typeName) {
    const start = source.indexOf(`export type ${typeName} =`);
    if (start === -1) throw new Error(`Type introuvable dans le contrat : ${typeName}`);
    const end = source.indexOf(";", start);
    return [...source.slice(start, end).matchAll(/"([a-zA-Z[\]-]+)"/g)].map((m) => m[1]).sort();
}

/** Reads an interface's keys from the contract, flat. */
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
        // Each `*Options` interface of the contract, flattened — the set the
        // schema declares flat on its side.
        //
        // ⚠️ `AttributeWidgetOptions` is excluded, and the omission was not
        // theoretical: it is the widget → options table, so its keys are the
        // 24 WIDGETS, not option keys. Without the exclusion, this assertion
        // compared 60 entries to 36 and turned red on its own bias. The 7th
        // instrument bias of the session, and the corollary "the preflight
        // may carry the blindness it measures" also holds for the gate
        // measuring parity.
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
        // An exemption whose widget has since been rendered is a ghost: it
        // would suggest a hole remains and mask the next one.
        const ghosts = UNRENDERED_EXEMPTIONS.filter((w) => RENDERED_WIDGETS.includes(w));
        expect(ghosts, "Exemption(s) fantôme(s) — le widget est rendu, l'entrée sort").toEqual([]);
    });

    it("ATTR-10 — AttributeCaptureWidget (TS) ≡ l'enum edit.widget du schéma (7.2)", () => {
        // The schema carries TWO widget vocabularies: the reading one
        // (ATTR-01 above) and the capture one. Without this assertion, the
        // second could drift from the first with nothing seeing it — and that
        // vocabulary is what decides which `field-renderer` component
        // receives the input.
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
        // 🛑 The assertion that settles `reviews` for good. The contract long
        // carried a comment claiming `reviews` was "display-only" while
        // `field-renderer` registers it — a contradiction that survived
        // because NOTHING confronted the two lists. It is settled in the
        // code's favour; this guard is what keeps the next one from lasting as long.
        //
        // ⚠️ The catalogue is read from the SOURCE rather than imported:
        // `field-renderer` is a published lib, and the guard must turn red on
        // the repo's state, not that of a possibly stale `dist/`.
        const builtins = readFileSync(
            resolve(REPO, "packages/libs/field-renderer/src/builtins.ts"),
            "utf8"
        );
        const registered = [...builtins.matchAll(/from "\.\/types\/([a-z-]+)\.js"/g)].map(
            (m) => m[1]
        );
        const contractWidgets = unionMembers(contractSource, "AttributeWidget");
        const displayOnly = unionMembers(contractSource, "AttributeDisplayOnlyWidget");

        // Anti-empty-gate: a broken extraction would come out green comparing nothing.
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
