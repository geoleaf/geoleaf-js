/**
 * The CAPTURE projection — the form schema derived from the attributes.
 *
 * What this suite proves, and nothing else proves:
 *
 *  1. That a field without `edit` is NOT captured — the meaning of the
 *     projection, and what replaces `formSchema` membership.
 *  2. That `edit.widget` overrides the read widget, without which
 *     `sites_rosario.statut` would be captured with the `badge` component,
 *     which emits `{label, color}` into a scalar column `write.properties`
 *     ships flat.
 *  3. That the options bag is FLATTENED where the components read it. ⚠️ That
 *     half is not asserted, it is CONFRONTED: the expected keys are derived
 *     from `field-renderer`'s source, not copied here. A key nested instead of
 *     flat would produce a silently degraded component — `list` without
 *     `maxItems`, `image` without `uploadEndpoint` —, exactly the failure mode
 *     no appearance test sees.
 *  4. That the `properties.` prefix drops, which keeps `#gl-field-title`
 *     addressable and aligns the `values` map keys with `write.properties`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { attributesToFormSchema } from "../modal/attributes-to-form.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// __tests__ → src → editor → plugins → packages → <racine>
const REPO = resolve(__dirname, "../../../../..");

/** A complete attribute field, read-only by default. */
const field = (extra: Record<string, unknown> = {}) => ({
    field: "properties.x",
    label: "X",
    primitive: "string",
    widget: "text",
    display: { surfaces: ["popup"] },
    ...extra,
});

describe("attributesToFormSchema — ce qui est capturé", () => {
    it("un champ SANS edit n'est pas capturé", () => {
        expect(attributesToFormSchema({ fields: [field()] })).toEqual([]);
    });

    it("un champ AVEC edit est capturé", () => {
        const out = attributesToFormSchema({ fields: [field({ edit: {} })] });
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ id: "x", type: "text", label: "X" });
    });

    it("l'ordre de attributes.fields[] est conservé", () => {
        const out = attributesToFormSchema({
            fields: [
                field({ field: "properties.a", edit: {} }),
                field({ field: "properties.b" }), // non capturé
                field({ field: "properties.c", edit: {} }),
            ],
        });
        expect(out.map((f) => f.id)).toEqual(["a", "c"]);
    });

    it("un bloc attributes absent ou malformé rend une liste vide, sans jeter", () => {
        for (const input of [undefined, null, {}, { fields: null }, { fields: "nope" }, 42]) {
            expect(attributesToFormSchema(input)).toEqual([]);
        }
    });

    it("un champ sans `field` exploitable est ignoré plutôt que rendu sans id", () => {
        const out = attributesToFormSchema({ fields: [{ label: "X", widget: "text", edit: {} }] });
        expect(out).toEqual([]);
    });

    it("`required` ne remonte que s'il vaut true", () => {
        const fields = [
            field({ field: "properties.a", edit: { required: true } }),
            field({ field: "properties.b", edit: { required: false } }),
            field({ field: "properties.c", edit: {} }),
        ];
        const out = attributesToFormSchema({ fields });
        expect(out[0]?.required).toBe(true);
        expect(out[1]).not.toHaveProperty("required");
        expect(out[2]).not.toHaveProperty("required");
    });

    it("`computed` traverse la projection — il pilote le pré-remplissage géométrique", () => {
        const out = attributesToFormSchema({
            fields: [field({ computed: "geometry.area", edit: {} })],
        });
        expect(out[0]?.computed).toBe("geometry.area");
    });
});

describe("attributesToFormSchema — l'adressage", () => {
    it("le préfixe `properties.` de tête tombe (tourism)", () => {
        const out = attributesToFormSchema({
            fields: [field({ field: "properties.title", edit: {} })],
        });
        // This is what keeps `#gl-field-title` and aligns `write.properties`.
        expect(out[0]?.id).toBe("title");
    });

    it("un champ sans préfixe traverse inchangé (_reference)", () => {
        // ⚠️ Addressing is not uniform across profiles. One rule covers both:
        // without a prefix, the removal is a no-op.
        const out = attributesToFormSchema({ fields: [field({ field: "name", edit: {} })] });
        expect(out[0]?.id).toBe("name");
    });

    it("seul le préfixe de TÊTE tombe — l'imbriqué reste entier", () => {
        const out = attributesToFormSchema({
            fields: [field({ field: "properties.a.b", edit: {} })],
        });
        expect(out[0]?.id).toBe("a.b");
    });

    it("un `properties.` qui n'est pas en tête n'est pas touché", () => {
        const out = attributesToFormSchema({
            fields: [field({ field: "meta.properties.x", edit: {} })],
        });
        expect(out[0]?.id).toBe("meta.properties.x");
    });
});

describe("attributesToFormSchema — les deux projections", () => {
    it("sans edit.widget, la capture hérite du widget de lecture", () => {
        const out = attributesToFormSchema({ fields: [field({ widget: "longtext", edit: {} })] });
        expect(out[0]?.type).toBe("longtext");
    });

    it("edit.widget surcharge — le cas `statut` : badge en lecture, dropdown en saisie", () => {
        const out = attributesToFormSchema({
            fields: [
                field({
                    field: "properties.statut",
                    widget: "badge",
                    options: { placeholder: "…" },
                    edit: {
                        widget: "dropdown",
                        options: { options: [{ value: "Ouvert", label: "Ouvert" }] },
                    },
                }),
            ],
        });
        expect(out[0]?.type).toBe("dropdown");
        // 🛑 `edit.options` REPLACES the read bag, it does not merge: the two
        // are typed by different widgets, so `badge`'s `placeholder` has no
        // business in a `dropdown`'s config.
        expect(out[0]?.options).toEqual([{ value: "Ouvert", label: "Ouvert" }]);
        expect(out[0]).not.toHaveProperty("placeholder");
    });

    it("sans edit.options, le sac du champ sert les deux projections", () => {
        const out = attributesToFormSchema({
            fields: [field({ widget: "list", options: { maxItems: 12 }, edit: {} })],
        });
        expect(out[0]?.["maxItems"]).toBe(12);
    });

    it("le sac n'écrase jamais id/type/label", () => {
        const out = attributesToFormSchema({
            fields: [
                field({
                    field: "properties.a",
                    label: "Vrai label",
                    // A hostile bag: these keys are not legal options, but
                    // nothing in the type stops them from arriving here.
                    options: { id: "usurpé", type: "usurpé", label: "usurpé" },
                    edit: {},
                }),
            ],
        });
        expect(out[0]).toMatchObject({ id: "a", type: "text", label: "Vrai label" });
    });
});

/**
 * The confrontation: is the bag flattened WHERE the components read it?
 *
 * ⚠️ The expected keys are DERIVED from `field-renderer`'s source, never copied
 * — otherwise this suite would assert what it is supposed to verify.
 * `attributes` nests the options under `options`, `field-renderer` expects
 * them flat on `fieldConfig`: the translation lives in the adapter, and here
 * is where it is enforceable.
 */
describe("attributesToFormSchema — le sac d'options atteint son composant", () => {
    /** The keys a component reads on its `fieldConfig`, read from its source. */
    function keysReadBy(widget: string): string[] {
        const src = readFileSync(
            resolve(REPO, `packages/libs/field-renderer/src/types/${widget}.ts`),
            "utf8"
        );
        return [...new Set([...src.matchAll(/fieldConfig\.([a-zA-Z]+)/g)].map((m) => m[1]))];
    }

    /** The field contract's keys, which are not options. */
    const CONTRACT_KEYS = ["id", "type", "label", "required", "computed"];

    // The widgets actually carried by the two migrated profiles, each with an
    // options bag its component consumes.
    const CASES: Array<[string, Record<string, unknown>]> = [
        ["dropdown", { options: [{ value: "a", label: "A" }], emptyLabel: "—" }],
        ["longtext", { rows: 6, maxLength: 400 }],
        ["list", { maxItems: 12, addLabel: "+" }],
        ["tags", { options: [{ value: "a", label: "A" }], maxTags: 6 }],
        ["table", { columns: [{ key: "k", label: "K" }], maxRows: 7 }],
        ["image", { uploadEndpoint: "/api/upload", maxSizeMb: 5 }],
        ["gallery", { uploadEndpoint: "/api/upload", maxCount: 8, maxSizeMb: 5 }],
        ["url", { placeholder: "https://" }],
    ];

    it("garde anti-gate-vide : chaque composant lit bien des clés de config", () => {
        for (const [widget] of CASES) {
            const read = keysReadBy(widget).filter((k) => !CONTRACT_KEYS.includes(k));
            expect(
                read.length,
                `aucune option lue par ${widget} — extraction cassée ?`
            ).toBeGreaterThan(0);
        }
    });

    it.each(CASES)("%s — chaque option du sac arrive à plat et est lue", (widget, bag) => {
        const out = attributesToFormSchema({
            fields: [field({ field: "properties.x", widget, edit: { widget, options: bag } })],
        });
        const produced = out[0] as Record<string, unknown>;
        const read = keysReadBy(widget);

        for (const key of Object.keys(bag)) {
            // Flat on the descriptor, not under `options` — except `options`
            // itself, which IS a top-level key for `dropdown` and `tags`.
            expect(produced, `${widget}.${key} absent du descripteur`).toHaveProperty(key);
            expect(produced[key]).toEqual(bag[key]);
            // And the component really reads it: an option no component ever
            // consults would be a dead contract, of the kind an earlier sweep
            // removed two dozen of.
            expect(read, `${widget} ne lit jamais fieldConfig.${key}`).toContain(key);
        }
    });
});
