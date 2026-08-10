/**
 * Le contrat attributaire est-il OPPOSABLE ? — tâches 2.7 et 2.8 de
 * `roadmap_collecte-terrain-offline`.
 *
 * ⚠️ Ces deux gardes ont été « vues rougir » à l'Étape 1 — mais à la MAIN, pendant
 * l'implémentation, et rien n'en est resté. Mesuré au pré-vol du Sprint 2 :
 * `grep -rln "attributes.contract" __tests__/` ne rendait aucun test, et
 * `s13-layers-anomalies-lock.test.js` ne mentionnait ni `attributes`, ni `primitive`,
 * ni `widget`, ni A14. Une vérification manuelle ne survit pas à la session qui l'a
 * faite : c'est ce que ces deux suites remplacent.
 *
 * Ce qu'elles prouvent, et que rien d'autre ne prouve :
 *
 *   2.7 — **A10**, la liste blanche des couples (`primitive`, `widget`). C'est la
 *         raison d'être des DEUX colonnes de type (décision A13) : avec une seule
 *         colonne « représentation », le validateur n'aurait rien à confronter et ne
 *         pourrait refuser aucune combinaison.
 *   2.8 — **A14**, « un champ en écriture oblige sa couche à déclarer son éditabilité
 *         ET sa cible d'écriture ». Exprimée en JSON Schema pur (`if`/`contains`/
 *         `then`), jamais en script.
 *
 * 🛑 **Une garde jamais vue rouge ne garde rien.** Chaque cas négatif ci-dessous a été
 * éprouvé par mutation du schéma au moment de son écriture : rendre le couple légal,
 * ou retirer la branche A14, fait tomber la suite. Le balayage systématique est ce qui
 * empêche qu'une branche `if`/`then` devienne inerte sans que personne le voie.
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
 * Le couple légal de chaque widget, LU DANS LE CONTRAT.
 *
 * ⚠️ Dérivé, jamais recopié — sans quoi cette suite affirmerait ce qu'elle est censée
 * vérifier. Et c'est bien une confrontation : la table vient du contrat TypeScript, le
 * verdict vient du schéma JSON. Les deux peuvent diverger, et ATTR-01 de la garde de
 * parité s'occupe de leurs LISTES ; ici, on éprouve leur COMPORTEMENT.
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

/** Une config de couche minimale, fusionnée avec le fragment éprouvé. */
const doc = (extra) => ({ id: "probe", ...extra });

/** Une couche portant un unique champ attributaire. */
const withField = (field, extra = {}) => doc({ ...extra, attributes: { fields: [field] } });

/** Un descripteur de champ complet, en lecture seule. */
const field = (primitive, widget, extra = {}) => ({
    field: "properties.x",
    label: "X",
    primitive,
    widget,
    display: { surfaces: ["popup"] },
    // `action` est le seul widget à exiger ses options — son `actionId` est porteur.
    ...(widget === "action" ? { options: { actionId: "a" } } : {}),
    ...extra,
});

describe("2.7 — A10 : la liste blanche des couples (primitive, widget)", () => {
    it("le contrat déclare un couple légal pour chaque widget", () => {
        // Garde anti-gate-vide : si l'extraction casse, tout le balayage ci-dessous
        // sortirait vert en n'ayant rien éprouvé.
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
        // ⚠️ C'est l'énoncé exact de Mattieu — « si la donnée est un nombre et qu'on
        // dit de l'afficher en date, ça coincera ». Avec une seule colonne
        // « représentation », rien ne coincerait.
        expect(validate(withField(field("number", "date")))).toBe(false);
    });

    it("un widget hors enum est refusé, pas ignoré", () => {
        expect(validate(withField(field("string", "sparkline")))).toBe(false);
    });

    it("une faute de frappe dans les options est refusée", () => {
        // `maxRow` pour `maxRows` — le cas vu rougir à l'Étape 1, désormais permanent.
        expect(validate(withField(field("object[]", "table", { options: { maxRow: 5 } })))).toBe(
            false
        );
    });

    it("une clé d'option légale sur un AUTRE widget passe — asymétrie CONNUE", () => {
        // 🛑 Ce n'est pas un oubli, c'est une limite mesurée et écrite sur place dans
        // le schéma : `attributeOptions` est PLAT, donc il vérifie « cette clé
        // existe-t-elle » et non « est-elle légale pour ce widget ». Le contrat
        // TypeScript, lui, contraint bien par widget. Fermer le cas général demande
        // une branche par widget — versé au registre, pas fait au passage.
        //
        // ⚠️ Le cas est verrouillé ICI plutôt que tu, pour qu'il soit trouvé le jour
        // où quelqu'un décidera de le fermer.
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
        // 🛑 L'ancrage est un ARBITRAGE de 5.9, pas une évidence, et c'est cette garde qui le
        // rend falsifiable : `edit` sur un attribut décrit la modification d'une valeur
        // EXISTANTE. S'ancrer sur `create` laisserait une couche qui ne sait que créer
        // déclarer des champs qu'elle ne pourra jamais éditer.
        // ⚠️ A14 a DEUX sujets vivants depuis 7.2 (`tourism/sites_rosario` et
        // `_reference/reference-points`) — ce commentaire disait « AUCUN » et il a cessé
        // d'être vrai le jour de la migration. Mais deux sujets vivants n'éprouvent que le
        // cas POSITIF : aucun profil ne peut porter une couche invalide, par construction.
        // Les cinq cas négatifs ci-dessus n'ont donc toujours qu'un seul instrument, celui-ci.
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
        // ⚠️ C'est le rôle du `required: ["attributes"]` dans le `if`. Sans lui, une
        // couche sans attributs satisfait vacuement le `contains` et se voit exiger
        // `edition` + `write` — 6 couches sur 24 seraient devenues invalides.
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
        // Et même en fournissant tout ce que A14 demanderait, il reste refusé : la
        // contrainte porte sur le widget, pas sur la couche.
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
 * 7.2 — `edit` cesse d'être `{required?}` et devient une PROJECTION, symétrique de
 * `display`.
 *
 * Le mécanisme, mesuré au 07/08/2026 : `AttributeWidgetOptions` est indexé PAR WIDGET.
 * `BadgeOptions` vaut `{placeholder?}` et n'a nulle part où porter une liste de choix,
 * `DropdownOptions` porte `options`. Un seul slot `widget` n'admet donc qu'UN sac
 * d'options typé — et deux projections qui veulent deux widgets veulent deux paires.
 * C'est ce qui a écarté la table de correspondance en dur : `badge→dropdown` n'aurait eu
 * aucun endroit typé où mettre les trois choix de `sites_rosario.statut`.
 *
 * 🛑 Ce que ce bloc garde, et que rien d'autre ne garde : que la paire de capture soit
 * confrontée comme l'est la paire de lecture. Sans lui, `edit.widget` serait un champ
 * libre, et un widget inconnu tomberait dans le repli SILENCIEUX
 * `?? ComponentRegistry.get("text")` de `field-renderer-bridge.ts`.
 */
describe("7.2 — la paire de CAPTURE (primitive, edit.widget)", () => {
    const WRITE = { enabled: true, endpoint: "https://backend.test/collections/x" };

    /** Une couche éditable complète, pour qu'A14 ne soit jamais la cause du rouge. */
    const editableLayer = (fieldDesc) =>
        withField(fieldDesc, { edition: { update: true }, write: WRITE });

    /**
     * Les widgets dont la valeur de CAPTURE est un objet, quel que soit ce qu'ils lisent.
     * `badge` émet `{label, color}`, `link` émet `{href, label?}`, `price` un montant —
     * mesuré dans `packages/libs/field-renderer/src/types/`.
     */
    const OBJECT_CAPTURE = ["badge", "link", "price"];

    /**
     * La table de capture, DÉRIVÉE de la table de lecture — jamais retapée.
     *
     * Deux retraits, tous deux motivés : `action`, dont `field-renderer` n'enregistre
     * aucun composant ; et, sur une primitive `string` SEULEMENT, les trois widgets
     * ci-dessus — capturer un objet dans une colonne scalaire est exactement ce que
     * `write.properties` expédierait à plat au backend.
     */
    const captureWidgets = (primitive) =>
        Object.keys(LEGAL).filter(
            (w) =>
                LEGAL[w].includes(primitive) &&
                w !== "action" &&
                !(primitive === "string" && OBJECT_CAPTURE.includes(w))
        );

    /**
     * Le widget de LECTURE utilisé pour éprouver `edit.widget` — jamais `action`.
     *
     * 🛑 Ce helper existe à cause d'un faux vert MESURÉ le 07/08/2026. Le balayage
     * négatif ci-dessous prenait « le premier widget légal pour cette primitive », qui
     * est `action` en `string` par ordre de déclaration du contrat. Or `action` porte
     * `not: {required: ["edit"]}` : TOUT champ le déclarant avec un `edit` est refusé,
     * quel que soit `edit.widget`. Le balayage rougissait donc pour la mauvaise raison,
     * et supprimer l'enum de capture de la branche `string` — la seule branche où elle
     * restreint quoi que ce soit — laissait la suite VERTE.
     */
    const readWidgetFor = (primitive) => captureWidgets(primitive)[0];

    it("garde anti-gate-vide : la table de capture n'est pas vide, et elle est plus étroite en string", () => {
        // Sans cette assertion, une extraction cassée ferait sortir tout le balayage
        // ci-dessous vert en n'ayant éprouvé aucun couple.
        expect(captureWidgets("string").length).toBeGreaterThan(5);
        expect(captureWidgets("object")).toEqual(expect.arrayContaining(["badge", "link"]));
        expect(captureWidgets("string")).not.toContain("badge");
        // Et le porteur du balayage négatif ne doit JAMAIS être `action`, sans quoi le
        // rouge viendrait de sa propre règle et n'éprouverait pas la paire de capture.
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
                // Le widget de LECTURE reste légal ET neutre : seul `edit.widget` est en
                // cause, sans quoi le rouge pourrait venir d'A10 ou de la règle `action`
                // et ne rien prouver d'ici. Voir `readWidgetFor`.
                const desc = field(primitive, readWidgetFor(primitive), { edit: { widget } });
                expect(
                    validate(editableLayer(desc)),
                    `capture ILLÉGALE acceptée : (${primitive}, edit.widget=${widget}) — la branche de cette primitive est inerte`
                ).toBe(false);
            }
        });
    });

    it.each(ALL_PRIMITIVES)("`action` n'est capturable sur AUCUNE primitive (%s)", (primitive) => {
        // ⚠️ Doublement gardé, et c'est voulu : l'enum de tête l'exclut, ET aucune des six
        // branches par primitive ne le liste. La mutation qui l'ajoute à l'enum de tête
        // sort donc verte — ce sont les branches qui mordent, et c'est elles qu'on éprouve
        // en balayant les six primitives plutôt qu'une seule.
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
 * A17 — un widget de lecture à valeur OBJET posé sur une valeur `string` doit nommer
 * son widget de capture.
 *
 * 🛑 C'est la forme exacte de `sites_rosario.statut` avant 7.2 : `primitive: "string"`,
 * `widget: "badge"`, donnée `"Ouvert"`. La lecture le tolère délibérément
 * (`textOfBadge` branche sur le type) ; la capture, elle, aurait émis `{label, color}`
 * dans une colonne que `write.properties` expédie à plat. Sans cette règle, `edit` sans
 * `widget` héritait de `badge` et personne ne l'aurait vu.
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
        // Ici `badge` lit ET capture `{label, color}` : les deux projections sont
        // d'accord, et exiger une déclaration serait du bruit.
        const desc = field("object", "badge", { edit: { required: true } });
        expect(validate(editableLayer(desc)), JSON.stringify(validate.errors)).toBe(true);
    });

    it("la règle ne mord PAS sur un champ en lecture seule", () => {
        // Pas d'`edit`, donc aucune capture à contraindre — et c'était le cas de
        // `statut` pendant tout le Sprint 7 avant cette tâche.
        expect(validate(withField(field("string", "badge")))).toBe(true);
    });

    it("elle ne mord pas sur un widget scalaire", () => {
        const desc = field("string", "text", { edit: { required: true } });
        expect(validate(editableLayer(desc)), JSON.stringify(validate.errors)).toBe(true);
    });
});
