/*!
 * @geoleaf-plugins/editor — attributes.fields[] → FieldConfig[]
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The CAPTURE projection — task 7.2.
 *
 * A profile now carries ONE field list (`attributes.fields[]`) with two projections —
 * `display` for reading, `edit` for capture — and this module translates the second into
 * the contract `field-renderer` consumes.
 *
 * ⚠️ It REPLACES the reading of `formSchema`, removed in the same task (decision A15: the
 * removal belongs to the sprint that makes the code useless). `formSchema` was a second
 * field list, parallel to `attributes.fields[]` and reconciled with it by nothing.
 */

import type { FieldConfig } from "@geoleaf/field-renderer";

/** Un champ du bloc `attributes` d'une couche, tel qu'il vit dans le JSON du profil. */
interface AttributeFieldLike {
    field?: unknown;
    label?: unknown;
    widget?: unknown;
    computed?: unknown;
    options?: unknown;
    edit?: {
        required?: unknown;
        widget?: unknown;
        options?: unknown;
    };
}

/**
 * Retire le préfixe `properties.` de tête d'un chemin de champ.
 *
 * 🛑 Ce retrait est PORTEUR, pas cosmétique. Il aligne trois choses qui divergeraient
 * sans lui :
 *  - la clé du `values` map que `createFieldRendererBridge` construit, qui part telle
 *    quelle à la persistance ;
 *  - `write.properties`, qui est une liste PLATE (`["title", …]`) et sert de liste
 *    blanche à l'expédition vers le backend ;
 *  - l'`id` DOM `#gl-field-<id>`, sur lequel `e2e/09-editor.spec.js` a des assertions
 *    dures, et qu'un point rendrait par ailleurs inadressable en sélecteur CSS non
 *    échappé.
 *
 * ⚠️ Seul le préfixe de TÊTE est traité, et c'est délibéré : `properties.a.b` rendrait
 * `a.b`, une clé plate qui ne reconstruit aucune imbrication. L'adressage des champs
 * imbriqués est un sujet distinct, suivi au backlog sous **B-132**. Aucun des deux
 * profils migrés à 7.2 n'en porte.
 *
 * ⚠️ L'adressage n'est PAS uniforme entre profils — `properties.title` côté `tourism`,
 * `name` côté `_reference`. Une seule règle couvre les deux : sans préfixe, le retrait
 * est un no-op.
 */
function stripPropertiesPrefix(path: string): string {
    return path.startsWith("properties.") ? path.slice("properties.".length) : path;
}

/**
 * Projette les champs CAPTURABLES d'un bloc `attributes` vers le contrat field-renderer.
 *
 * Un champ sans `edit` n'est pas capturé : c'est le sens même de la projection, et c'est
 * ce qui remplace l'appartenance à `formSchema`.
 *
 * `widget` et `options` du niveau champ sont les valeurs par DÉFAUT ; `edit.widget` et
 * `edit.options` les surchargent. La surcharge n'existe que là où les deux projections
 * divergent réellement — mesuré à la migration : 1 champ sur 11.
 *
 * ⚠️ Le sac d'options est APLATI sur le descripteur, parce que c'est là que les
 * composants le lisent : `dropdown` lit `fieldConfig.options`, `list` lit
 * `fieldConfig.maxItems`, `image` lit `fieldConfig.uploadEndpoint`, `longtext` lit
 * `fieldConfig.rows`. `attributes` le niche sous `options`, `field-renderer` l'attend à
 * plat — la traduction est ici, elle n'est pas supposée : chaque widget porté par les
 * profils est couvert un par un dans `__tests__/attributes-to-form.test.ts`.
 *
 * @param attributes - Le bloc `attributes` de la couche, ou toute valeur si absent.
 * @returns Les descripteurs de champs à saisir, dans l'ordre de `attributes.fields[]`.
 *
 * @example
 * ```ts
 * attributesToFormSchema({
 *     fields: [
 *         {
 *             field: "properties.statut",
 *             label: "Statut",
 *             primitive: "string",
 *             widget: "badge",
 *             edit: { widget: "dropdown", options: { options: [{ value: "Ouvert", label: "Ouvert" }] } },
 *         },
 *     ],
 * });
 * // → [{ id: "statut", type: "dropdown", label: "Statut", options: [{ value: "Ouvert", label: "Ouvert" }] }]
 * ```
 */
export function attributesToFormSchema(attributes: unknown): FieldConfig[] {
    const fields = (attributes as { fields?: unknown } | null)?.fields;
    if (!Array.isArray(fields)) return [];

    const out: FieldConfig[] = [];
    for (const raw of fields as AttributeFieldLike[]) {
        const edit = raw?.edit;
        if (!edit || typeof edit !== "object") continue;
        if (typeof raw.field !== "string") continue;

        const widget = typeof edit.widget === "string" ? edit.widget : raw.widget;
        if (typeof widget !== "string") continue;

        // `edit.options` REMPLACE le sac du champ, il ne s'y ajoute pas : les deux sont
        // typés par des widgets différents, donc les fusionner mélangerait deux
        // vocabulaires. Le schéma impose `edit.widget` dès que `edit.options` est là.
        const bag = edit.options ?? raw.options;
        const flat = bag && typeof bag === "object" ? (bag as Record<string, unknown>) : {};

        out.push({
            ...flat,
            id: stripPropertiesPrefix(raw.field),
            type: widget,
            label: typeof raw.label === "string" ? raw.label : stripPropertiesPrefix(raw.field),
            ...(edit.required === true && { required: true }),
            // ⚠️ `NonNullable`, pas `FieldConfig["computed"]` : sous
            // `exactOptionalPropertyTypes`, une propriété optionnelle n'accepte pas
            // `undefined` comme VALEUR, et le type du champ l'inclut.
            ...(typeof raw.computed === "string" && {
                computed: raw.computed as NonNullable<FieldConfig["computed"]>,
            }),
        });
    }
    return out;
}
