/**
 * La projection de CAPTURE — tâche 7.2 de `roadmap_collecte-terrain-offline`.
 *
 * Ce que cette suite prouve, et que rien d'autre ne prouve :
 *
 *  1. Qu'un champ sans `edit` n'est PAS capturé — c'est le sens de la projection, et ce
 *     qui remplace l'appartenance à `formSchema`.
 *  2. Que `edit.widget` surcharge le widget de lecture, sans quoi `sites_rosario.statut`
 *     serait saisi avec le composant `badge`, qui émet `{label, color}` dans une colonne
 *     scalaire que `write.properties` expédie à plat.
 *  3. Que le sac d'options est APLATI là où les composants le lisent. ⚠️ Cette moitié-là
 *     n'est pas affirmée, elle est CONFRONTÉE : les clés attendues sont dérivées de la
 *     source de `field-renderer`, pas recopiées ici. Une clé nichée au lieu d'être à
 *     plat produirait un composant silencieusement dégradé — `list` sans `maxItems`,
 *     `image` sans `uploadEndpoint` —, exactement le mode d'échec qu'aucun test
 *     d'apparence ne voit.
 *  4. Que le préfixe `properties.` tombe, ce qui garde `#gl-field-title` adressable et
 *     aligne les clés du `values` map sur `write.properties`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { attributesToFormSchema } from "../modal/attributes-to-form.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// __tests__ → src → editor → plugins → packages → <racine>
const REPO = resolve(__dirname, "../../../../..");

/** Un champ attributaire complet, en lecture seule par défaut. */
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
        // C'est ce qui garde `#gl-field-title` et aligne `write.properties`.
        expect(out[0]?.id).toBe("title");
    });

    it("un champ sans préfixe traverse inchangé (_reference)", () => {
        // ⚠️ L'adressage n'est pas uniforme entre profils. Une seule règle couvre les
        // deux : sans préfixe, le retrait est un no-op.
        const out = attributesToFormSchema({ fields: [field({ field: "name", edit: {} })] });
        expect(out[0]?.id).toBe("name");
    });

    it("seul le préfixe de TÊTE tombe — l'imbriqué reste entier (B-132)", () => {
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
        // 🛑 `edit.options` REMPLACE le sac de lecture, il ne fusionne pas : les deux
        // sont typés par des widgets différents, donc `placeholder` de `badge` n'a
        // rien à faire dans la config d'un `dropdown`.
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
                    // Un sac hostile : ces clés ne sont pas des options légales, mais
                    // rien dans le type ne les empêche d'arriver ici.
                    options: { id: "usurpé", type: "usurpé", label: "usurpé" },
                    edit: {},
                }),
            ],
        });
        expect(out[0]).toMatchObject({ id: "a", type: "text", label: "Vrai label" });
    });
});

/**
 * La confrontation : le sac est-il aplati LÀ OÙ les composants le lisent ?
 *
 * ⚠️ Les clés attendues sont DÉRIVÉES de la source de `field-renderer`, jamais recopiées
 * — sans quoi cette suite affirmerait ce qu'elle est censée vérifier. `attributes` niche
 * les options sous `options`, `field-renderer` les attend à plat sur `fieldConfig` : la
 * traduction est dans l'adaptateur, et c'est ici qu'elle est opposable.
 */
describe("attributesToFormSchema — le sac d'options atteint son composant", () => {
    /** Les clés qu'un composant lit sur son `fieldConfig`, lues dans sa source. */
    function keysReadBy(widget: string): string[] {
        const src = readFileSync(
            resolve(REPO, `packages/libs/field-renderer/src/types/${widget}.ts`),
            "utf8"
        );
        return [...new Set([...src.matchAll(/fieldConfig\.([a-zA-Z]+)/g)].map((m) => m[1]))];
    }

    /** Les clés du contrat de champ, qui ne sont pas des options. */
    const CONTRACT_KEYS = ["id", "type", "label", "required", "computed"];

    // Les widgets réellement portés par les deux profils migrés, chacun avec un sac
    // d'options que son composant consomme.
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
            // À plat sur le descripteur, et non sous `options` — sauf `options` lui-même,
            // qui EST une clé de premier niveau pour `dropdown` et `tags`.
            expect(produced, `${widget}.${key} absent du descripteur`).toHaveProperty(key);
            expect(produced[key]).toEqual(bag[key]);
            // Et le composant la lit vraiment : une option qu'aucun composant ne consulte
            // serait un contrat mort, du genre de ceux que 7.1b a retirés par 24.
            expect(read, `${widget} ne lit jamais fieldConfig.${key}`).toContain(key);
        }
    });
});
