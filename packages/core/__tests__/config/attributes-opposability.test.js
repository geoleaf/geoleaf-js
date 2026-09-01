/**
 * Is the attribute contract ENFORCEABLE?
 *
 * ⚠️ These two guards were "seen turning red" at Step 1 — but by HAND, during
 * implementation, and nothing remained of it. Measured later:
 * `grep -rln "attributes.contract" __tests__/` returned no test, and
 * `s13-layers-anomalies-lock.test.js` mentioned neither `attributes`, nor
 * `primitive`, nor `widget`, nor A14. A manual check does not survive the
 * session that made it: that is what these two suites replace.
 *
 * What they prove, and nothing else proves:
 *
 *   2.7 — **A10**, the whitelist of (`primitive`, `widget`) pairs. The
 *         reason for the TWO type columns: with a single "representation"
 *         column, the validator would have nothing to confront and could
 *         refuse no combination.
 *   2.8 — **A14**, "a writable field forces its layer to declare its
 *         editability AND its write target". Expressed in pure JSON Schema
 *         (`if`/`contains`/`then`), never in a script.
 *
 * 🛑 **A guard never seen red guards nothing.» Each negative case below was
 * exercised by mutating the schema as it was written: making the pair legal,
 * or removing the A14 branch, brings the suite down. The systematic sweep is
 * what keeps an `if`/`then` branch from going inert with nobody seeing it.
 */

import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// config → __tests__ → core → packages → <racine>
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const readText = (p) => readFileSync(resolve(ROOT, p), "utf8");

const schema = JSON.parse(readText("profiles/schemas/layer-config.schema.json"));
const contractSource = readText("packages/core/src/contracts/attributes.contract.ts");

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validate = ajv.compile(schema);

/**
 * Each widget's legal pair, READ FROM THE CONTRACT.
 *
 * ⚠️ Derived, never copied — otherwise this suite would assert what it is
 * supposed to verify. And it is indeed a confrontation: the table comes from
 * the TypeScript contract, the verdict from the JSON schema. The two can
 * diverge, and the parity guard's ATTR-01 handles their LISTS; here, their
 * BEHAVIOUR is exercised.
 */
function legalPrimitives() {
    const start = contractSource.indexOf("export interface AttributeWidgetPrimitive {");
    const body = contractSource.slice(start, contractSource.indexOf("\n}", start));
    const out = {};
    for (const m of body.matchAll(/^\s{4}([a-z]+):\s*(.+);$/gm)) {
        out[m[1]] = m[2].split("|").map((p) => p.trim().replace(/"/g, ""));
    }
    return out;
}

const LEGAL = legalPrimitives();
const ALL_PRIMITIVES = ["string", "number", "boolean", "string[]", "object", "object[]"];

/** A minimal layer config, merged with the exercised fragment. */
const doc = (extra) => ({ id: "probe", ...extra });

/** A layer carrying a single attribute field. */
const withField = (field, extra = {}) => doc({ ...extra, attributes: { fields: [field] } });

/** A complete field descriptor, read-only. */
const field = (primitive, widget, extra = {}) => ({
    field: "properties.x",
    label: "X",
    primitive,
    widget,
    display: { surfaces: ["popup"] },
    // `action` is the only widget requiring its options — its `actionId` is load-bearing.
    ...(widget === "action" ? { options: { actionId: "a" } } : {}),
    ...extra,
});

describe("2.7 — A10 : la liste blanche des couples (primitive, widget)", () => {
    it("le contrat déclare un couple légal pour chaque widget", () => {
        // Anti-empty-gate guard: if the extraction breaks, the whole sweep
        // below would come out green having exercised nothing.
        expect(Object.keys(LEGAL).length).toBeGreaterThan(20);
        expect(LEGAL["checkbox"]).toEqual(["boolean", "string[]"]);
    });

    describe("chaque widget ACCEPTE sa primitive déclarée", () => {
        it.each(Object.keys(LEGAL))("%s", (widget) => {
            for (const primitive of LEGAL[widget]) {
                expect(
                    validate(withField(field(primitive, widget))),
                    `couple légal refusé : (${primitive}, ${widget}) — ${JSON.stringify(validate.errors)}`
                ).toBe(true);
            }
        });
    });

    describe("chaque widget REFUSE toute autre primitive", () => {
        it.each(Object.keys(LEGAL))("%s", (widget) => {
            const illegal = ALL_PRIMITIVES.filter((p) => !LEGAL[widget].includes(p));
            expect(illegal.length).toBeGreaterThan(0);
            for (const primitive of illegal) {
                expect(
                    validate(withField(field(primitive, widget))),
                    `couple ILLÉGAL accepté : (${primitive}, ${widget}) — la branche if/then de cette primitive est inerte`
                ).toBe(false);
            }
        });
    });

    it("le cas qui a motivé les deux colonnes : un nombre affiché en date", () => {
        // ⚠️ Mattieu's exact wording — "if the data is a number and we say to
        // display it as a date, it will jam". With a single "representation"
        // column, nothing would jam.
        expect(validate(withField(field("number", "date")))).toBe(false);
    });

    it("un widget hors enum est refusé, pas ignoré", () => {
        expect(validate(withField(field("string", "sparkline")))).toBe(false);
    });

    it("une faute de frappe dans les options est refusée", () => {
        // `maxRow` for `maxRows` — the case seen red at Step 1, now permanent.
        expect(validate(withField(field("object[]", "table", { options: { maxRow: 5 } })))).toBe(
            false
        );
    });

    it("une clé d'option légale sur un AUTRE widget passe — asymétrie CONNUE", () => {
        // 🛑 Not an oversight, a limit measured and written in place in the
        // schema: `attributeOptions` is FLAT, so it checks "does this key
        // exist" and not "is it legal for this widget". The TypeScript
        // contract does constrain per widget. Closing the general case takes
        // one branch per widget — filed, not done in passing.
        //
        // ⚠️ The case is locked HERE rather than silenced, so it is found the
        // day someone decides to close it.
        expect(validate(withField(field("number", "rating", { options: { maxRows: 5 } })))).toBe(
            true
        );
    });

    it("un champ sans display et sans edit est refusé (Q3)", () => {
        expect(
            validate(
                withField({
                    field: "properties.x",
                    label: "X",
                    primitive: "string",
                    widget: "text",
                })
            )
        ).toBe(false);
    });
});

describe("2.8 — A14 : un champ en écriture exige une couche éditable ET une cible", () => {
    const editable = field("string", "text", { edit: { required: true } });
    const WRITE = { enabled: true, endpoint: "https://backend.test/collections/x" };

    it("edit SANS edition.update ni write est refusé", () => {
        expect(validate(withField(editable))).toBe(false);
    });

    it("edit avec edition.update mais SANS write est refusé — la seconde moitié compte", () => {
        expect(validate(withField(editable, { edition: { update: true } }))).toBe(false);
    });

    it("edit avec write mais SANS edition.update est refusé", () => {
        expect(validate(withField(editable, { write: WRITE }))).toBe(false);
    });

    it("edit avec edition.update à FALSE est refusé — la règle exige `true`, pas la clé", () => {
        expect(validate(withField(editable, { edition: { update: false }, write: WRITE }))).toBe(
            false
        );
    });

    it("edit avec `create` SEUL est refusé — la règle s'ancre sur `update`, pas sur `create`", () => {
        // 🛑 The anchoring is an ARBITRATION, not an evidence, and this guard
        // is what makes it falsifiable: `edit` on an attribute describes
        // modifying an EXISTING value. Anchoring on `create` would let a
        // layer that only knows how to create declare fields it will never
        // be able to edit.
        // ⚠️ A14 has TWO live subjects (`tourism/sites_rosario` and
        // `_reference/reference-points`) — this comment said "NONE" and
        // stopped being true the day of the migration. But two live subjects
        // only exercise the POSITIVE case: no profile can carry an invalid
        // layer, by construction. The five negative cases above thus still
        // have a single instrument, this one.
        expect(validate(withField(editable, { edition: { create: true }, write: WRITE }))).toBe(
            false
        );
    });

    it("edit avec les deux est accepté", () => {
        expect(
            validate(withField(editable, { edition: { update: true }, write: WRITE })),
            JSON.stringify(validate.errors)
        ).toBe(true);
    });

    it("un write incomplet ne suffit pas — endpoint est requis", () => {
        expect(
            validate(withField(editable, { edition: { update: true }, write: { enabled: true } }))
        ).toBe(false);
    });

    it("la règle ne se déclenche PAS sur une couche sans champ en écriture", () => {
        expect(validate(withField(field("string", "text")))).toBe(true);
    });

    it("elle ne matche pas À VIDE sur une couche sans bloc attributes", () => {
        // ⚠️ The role of the `required: ["attributes"]` in the `if`. Without
        // it, an attribute-less layer vacuously satisfies the `contains` and
        // gets required `edition` + `write` — 6 layers out of 24 would have
        // become invalid.
        expect(validate(doc({}))).toBe(true);
        expect(validate(doc({ label: "Une couche sans attributs" }))).toBe(true);
    });

    it("un SEUL champ en écriture parmi plusieurs suffit à déclencher la règle", () => {
        const fields = [field("string", "text"), field("number", "number"), editable];
        expect(validate(doc({ attributes: { fields } }))).toBe(false);
        expect(
            validate(doc({ attributes: { fields }, edition: { update: true }, write: WRITE }))
        ).toBe(true);
    });

    it("action ne peut pas déclencher la règle — il refuse edit (Q6)", () => {
        expect(validate(withField(field("string", "action", { edit: { required: true } })))).toBe(
            false
        );
        // And even providing everything A14 would ask, it stays refused: the
        // constraint bears on the widget, not the layer.
        expect(
            validate(
                withField(field("string", "action", { edit: { required: true } }), {
                    edition: { update: true },
                    write: WRITE,
                })
            )
        ).toBe(false);
    });
});

/**
 * `edit` stops being `{required?}` and becomes a PROJECTION, symmetric with
 * `display`.
 *
 * The mechanism, measured on 07/08/2026: `AttributeWidgetOptions` is indexed
 * BY WIDGET. `BadgeOptions` is `{placeholder?}` and has nowhere to carry a
 * choice list, `DropdownOptions` carries `options`. A single `widget` slot
 * thus admits only ONE typed options bag — and two projections wanting two
 * widgets want two pairs. That is what ruled out the hardcoded mapping
 * table: `badge→dropdown` would have had no typed place to put
 * `sites_rosario.statut`'s three choices.
 *
 * 🛑 What this block guards, and nothing else does: that the capture pair be
 * confronted as the reading pair is. Without it, `edit.widget` would be a
 * free field, and an unknown widget would fall into
 * `field-renderer-bridge.ts`'s SILENT fallback
 * `?? ComponentRegistry.get("text")`.
 */
describe("7.2 — la paire de CAPTURE (primitive, edit.widget)", () => {
    const WRITE = { enabled: true, endpoint: "https://backend.test/collections/x" };

    /** A complete editable layer, so A14 is never the red's cause. */
    const editableLayer = (fieldDesc) =>
        withField(fieldDesc, { edition: { update: true }, write: WRITE });

    /**
     * The widgets whose CAPTURE value is an object, whatever they read.
     * `badge` emits `{label, color}`, `link` emits `{href, label?}`, `price`
     * an amount — measured in `packages/libs/field-renderer/src/types/`.
     */
    const OBJECT_CAPTURE = ["badge", "link", "price"];

    /**
     * The capture table, DERIVED from the reading table — never retyped.
     *
     * Two removals, both motivated: `action`, for which `field-renderer`
     * registers no component; and, on a `string` primitive ONLY, the three
     * widgets above — capturing an object into a scalar column is exactly
     * what `write.properties` would ship flat to the backend.
     */
    const captureWidgets = (primitive) =>
        Object.keys(LEGAL).filter(
            (w) =>
                LEGAL[w].includes(primitive) &&
                w !== "action" &&
                !(primitive === "string" && OBJECT_CAPTURE.includes(w))
        );

    /**
     * The READING widget used to exercise `edit.widget` — never `action`.
     *
     * 🛑 This helper exists because of a false green MEASURED on 07/08/2026.
     * The negative sweep below took "the first legal widget for this
     * primitive", which is `action` in `string` by the contract's
     * declaration order. Yet `action` carries `not: {required: ["edit"]}`:
     * ANY field declaring it with an `edit` is refused, whatever
     * `edit.widget`. The sweep thus turned red for the wrong reason, and
     * removing the capture enum from the `string` branch — the only branch
     * where it restricts anything — left the suite GREEN.
     */
    const readWidgetFor = (primitive) => captureWidgets(primitive)[0];

    it("garde anti-gate-vide : la table de capture n'est pas vide, et elle est plus étroite en string", () => {
        // Without this assertion, a broken extraction would let the whole
        // sweep below come out green having exercised no pair.
        expect(captureWidgets("string").length).toBeGreaterThan(5);
        expect(captureWidgets("object")).toEqual(expect.arrayContaining(["badge", "link"]));
        expect(captureWidgets("string")).not.toContain("badge");
        // And the negative sweep's carrier must NEVER be `action`, otherwise
        // the red would come from its own rule and not exercise the capture pair.
        for (const p of ALL_PRIMITIVES) {
            expect(readWidgetFor(p), `aucun widget de capture pour ${p}`).toBeDefined();
            expect(readWidgetFor(p)).not.toBe("action");
        }
    });

    describe("chaque primitive ACCEPTE ses widgets de capture", () => {
        it.each(ALL_PRIMITIVES)("%s", (primitive) => {
            for (const widget of captureWidgets(primitive)) {
                const desc = field(primitive, widget, { edit: { widget } });
                expect(
                    validate(editableLayer(desc)),
                    `capture légale refusée : (${primitive}, ${widget}) — ${JSON.stringify(validate.errors)}`
                ).toBe(true);
            }
        });
    });

    describe("chaque primitive REFUSE tout autre widget de capture", () => {
        it.each(ALL_PRIMITIVES)("%s", (primitive) => {
            const legal = captureWidgets(primitive);
            const illegal = Object.keys(LEGAL).filter((w) => !legal.includes(w));
            expect(illegal.length).toBeGreaterThan(0);
            for (const widget of illegal) {
                // The READING widget stays legal AND neutral: only
                // `edit.widget` is at stake, otherwise the red could come
                // from A10 or the `action` rule and prove nothing of this.
                // See `readWidgetFor`.
                const desc = field(primitive, readWidgetFor(primitive), { edit: { widget } });
                expect(
                    validate(editableLayer(desc)),
                    `capture ILLÉGALE acceptée : (${primitive}, edit.widget=${widget}) — la branche de cette primitive est inerte`
                ).toBe(false);
            }
        });
    });

    it.each(ALL_PRIMITIVES)("`action` n'est capturable sur AUCUNE primitive (%s)", (primitive) => {
        // ⚠️ Doubly guarded, on purpose: the head enum excludes it, AND none
        // of the six per-primitive branches lists it. The mutation adding it
        // to the head enum thus comes out green — the branches are what
        // bites, and they are what is exercised by sweeping all six
        // primitives rather than one.
        const desc = field(primitive, readWidgetFor(primitive), { edit: { widget: "action" } });
        expect(validate(editableLayer(desc))).toBe(false);
    });

    it("un edit.widget hors vocabulaire est refusé, pas ignoré", () => {
        const desc = field("string", "text", { edit: { widget: "sparkline" } });
        expect(validate(editableLayer(desc))).toBe(false);
    });

    it("edit.options SANS edit.widget est refusé — le sac serait typé par l'autre projection", () => {
        const desc = field("string", "text", { edit: { options: { rows: 3 } } });
        expect(validate(editableLayer(desc))).toBe(false);
    });

    it("edit.options AVEC edit.widget est accepté", () => {
        const desc = field("string", "badge", {
            edit: { widget: "dropdown", options: { options: [{ value: "o", label: "O" }] } },
        });
        expect(validate(editableLayer(desc)), JSON.stringify(validate.errors)).toBe(true);
    });

    it("une faute de frappe dans edit.options est refusée comme ailleurs", () => {
        const desc = field("string", "text", { edit: { widget: "longtext", options: { row: 3 } } });
        expect(validate(editableLayer(desc))).toBe(false);
    });

    it("edit sans widget hérite du widget de lecture — le cas des 10 champs sur 11", () => {
        const desc = field("string", "text", { edit: { required: true } });
        expect(validate(editableLayer(desc)), JSON.stringify(validate.errors)).toBe(true);
    });
});

/**
 * A17 — an OBJECT-valued reading widget set on a `string` value must name
 * its capture widget.
 *
 * 🛑 The exact shape of `sites_rosario.statut` before the fix:
 * `primitive: "string"`, `widget: "badge"`, data `"Ouvert"`. Reading
 * tolerates it deliberately (`textOfBadge` branches on the type); capture
 * would have emitted `{label, color}` into a column `write.properties` ships
 * flat. Without this rule, `edit` without `widget` inherited `badge` and
 * nobody would have seen it.
 */
describe("7.2 / A17 — la capture d'une valeur objet sur une primitive scalaire", () => {
    const WRITE = { enabled: true, endpoint: "https://backend.test/collections/x" };
    const editableLayer = (fieldDesc) =>
        withField(fieldDesc, { edition: { update: true }, write: WRITE });

    it.each(["badge", "link", "price"])(
        "%s en lecture sur une string : edit DOIT nommer son widget",
        (widget) => {
            const desc = field("string", widget, { edit: { required: true } });
            expect(validate(editableLayer(desc))).toBe(false);
        }
    );

    it.each(["badge", "link", "price"])("%s : nommer le widget de capture suffit", (widget) => {
        const desc = field("string", widget, { edit: { widget: "text" } });
        expect(validate(editableLayer(desc)), JSON.stringify(validate.errors)).toBe(true);
    });

    it("la règle ne mord PAS quand la valeur est réellement un objet", () => {
        // Here `badge` reads AND captures `{label, color}`: the two
        // projections agree, and requiring a declaration would be noise.
        const desc = field("object", "badge", { edit: { required: true } });
        expect(validate(editableLayer(desc)), JSON.stringify(validate.errors)).toBe(true);
    });

    it("la règle ne mord PAS sur un champ en lecture seule", () => {
        // No `edit`, hence no capture to constrain — and that was `statut`'s
        // case before this fix.
        expect(validate(withField(field("string", "badge")))).toBe(true);
    });

    it("elle ne mord pas sur un widget scalaire", () => {
        const desc = field("string", "text", { edit: { required: true } });
        expect(validate(editableLayer(desc)), JSON.stringify(validate.errors)).toBe(true);
    });
});
