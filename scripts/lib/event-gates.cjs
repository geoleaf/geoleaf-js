/*!
 * GeoLeaf — outillage de gates
 * © 2026 Mattieu Pottier · MIT
 */

/**
 * @file event-gates.cjs
 * @description EM-03 — relève les littéraux d'événement qui portent un domaine SANS le préfixe
 * `geoleaf:`. B-207, Sprint 2 de R9 `canaux-coupes`.
 *
 * ## 🛑 LA CÉCITÉ QUE CE FICHIER FERME
 *
 * `EVENT_LITERAL_RE` (`lib/event-names.cjs`) est ancré sur `^geoleaf:`. EM-01 ne peut donc ni
 * réclamer ni compter un événement qui ne porte pas le préfixe : un tel nom n'apparaît dans
 * **aucune** mesure — ni comme dette, ni comme manque, ni comme exemption. Ce n'est pas une
 * lacune de la baseline, c'est un angle mort du périmètre.
 *
 * 📌 Et le fait que EM-01 réclame ces noms **dès l'instant où ils entrent dans le domaine**
 * PROUVE la cécité au lieu de la démentir : la gate ne voit que ce qui a déjà accepté d'être vu.
 *
 * ## POURQUOI LA RÈGLE PORTE SUR LE DEUX-POINTS, ET NON SUR UNE ALLOWLIST
 *
 * Une gate ne peut pas exiger « aucun littéral hors préfixe » : le balayage du 16/08/2026 en a
 * relevé **22**, dont **19 sont des événements ÉTRANGERS parfaitement légitimes** — natifs DOM
 * (`click`, `DOMContentLoaded`, `toggle`), cycle de vie du Service Worker (`install`,
 * `activate`, `fetch`), MapLibre (`moveend`, `zoomend`, `idle`, `styledata`, `style.load`),
 * Terra Draw (`finish`, `deselect`). Les interdire n'aurait aucun sens ; les allowlister aurait
 * créé une liste qui grossit à chaque `addEventListener("click")`, donc une liste que personne
 * ne relit.
 *
 * ✅ **La mesure a donné un séparateur qui ne demande aucun entretien : AUCUN des 19 étrangers
 * ne contient de `:`, et LES TROIS du domaine en portaient tous.** Un événement natif n'est
 * jamais namespacé ; un événement de domaine l'est par convention. La règle est donc :
 *
 *   > Un littéral d'événement qui contient un `:` DOIT commencer par `geoleaf:`.
 *
 * Elle rend la classe **structurellement impossible** au lieu de la recenser, ce que la ligne
 * B-207 demandait explicitement — « rendre impossible un événement hors du domaine de nommage,
 * plutôt que de renommer le prochain ».
 *
 * ## ⚠️ CE QUE CETTE GATE NE VOIT PAS, ÉCRIT PLUTÔT QUE TU — le périmètre fait partie du verdict
 *
 * Elle inspecte des **sites d'appel**, là où EM-01 balaie des littéraux nus. C'est nécessaire
 * ici — un balayage de toutes les chaînes du dépôt signalerait chaque chaîne contenant un
 * `:` —, mais cela coûte deux angles morts, tous deux réels dans ce dépôt :
 *
 *   1. **Un nom composé à l'exécution** (`"geoleaf:" + kind`) n'est pas un littéral. C'est
 *      exactement ce que faisait `fireEvent` avant son retrait ; rien ne garantit que le patron
 *      ne revienne pas.
 *   2. **Un helper local dont le nom n'est pas dans `EVENT_GATES`.** Quatre modules émettent par
 *      un helper qui prend le nom en paramètre (l'en-tête de `check-event-map-coverage.cjs` les
 *      énumère). Ceux qui sont connus sont listés ci-dessous ; un cinquième, écrit demain sous
 *      un autre nom, passerait.
 *
 * Le remède n'est pas une allowlist mais l'assertion anti-gate-vide : si le balayage cesse de
 * trouver le moindre site d'appel, la gate **refuse de conclure** au lieu de sortir verte.
 */
"use strict";

const fs = require("node:fs");
const ts = require("typescript");

/**
 * Les portes d'émission et d'abonnement réellement utilisées dans ce dépôt.
 *
 * ⚠️ Les cinq dernières sont des **helpers locaux** qui prennent le nom en paramètre. Sans
 * elles, tout ce qui passe par un helper serait invisible — et c'est le patron majoritaire des
 * plugins `editor` et `websocket`.
 */
const EVENT_GATES = new Set([
    "dispatchEvent",
    "dispatchGeoLeafEvent",
    "addEventListener",
    "removeEventListener",
    "fire",
    "on",
    "off",
    "once",
    // Helpers locaux qui prennent le nom en paramètre.
    "emit",
    "_emit",
    "_dispatch",
    "_dispatchCustomEvent",
    "_firePluginEvent",
]);

/** Un littéral d'événement « namespacé » — la forme que la règle gouverne. */
const NAMESPACED_RE = /:/;

/** Le domaine, et le seul autorisé pour un événement namespacé. */
const DOMAIN_PREFIX = "geoleaf:";

/**
 * Échappatoire NOMMÉE, vide à dessein.
 *
 * 🛑 Elle existe pour qu'un cas légitime — une bibliothèque tierce qui namespacerait ses
 * événements avec un `:` — ait un endroit où être écrit AVEC SON MOTIF, plutôt que de faire
 * désarmer la règle. Elle est vide aujourd'hui parce que la mesure n'a rien trouvé de tel.
 *
 * ⚠️ Ne jamais y mettre un événement de GeoLeaf : le verdict du 16/08/2026 est qu'aucun
 * événement du domaine ne vit hors du préfixe. Y ajouter l'un des nôtres, ce serait rouvrir
 * B-207 sous couvert de l'exempter.
 *
 * Forme : `"nom:littéral": "motif — qui l'émet, et pourquoi il ne peut pas être préfixé"`.
 */
const FOREIGN_NAMESPACED = Object.freeze({});

/**
 * Relève les sites d'appel dont le 1er argument est un littéral d'événement namespacé.
 *
 * @param {string[]} files - Corpus de sources livrées.
 * @returns {{violations: Array<{name: string, file: string, line: number, gate: string}>, callSites: number}}
 *   `callSites` est la mesure de non-vacuité : à zéro, l'instrument est cassé, pas le code.
 */
function collectNamespacedEventLiterals(files) {
    const violations = [];
    let callSites = 0;

    for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

        const walk = (node) => {
            if (ts.isCallExpression(node)) {
                let fn = null;
                if (ts.isPropertyAccessExpression(node.expression)) fn = node.expression.name.text;
                else if (ts.isIdentifier(node.expression)) fn = node.expression.text;

                if (fn && EVENT_GATES.has(fn) && node.arguments.length > 0) {
                    const a0 = node.arguments[0];
                    // Littéral de chaîne uniquement. Un nom dynamique n'est pas le sujet : la
                    // règle porte sur ce qui est ÉCRIT, et l'angle mort est déclaré en en-tête.
                    if (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0)) {
                        callSites++;
                        const name = a0.text;
                        if (
                            NAMESPACED_RE.test(name) &&
                            !name.startsWith(DOMAIN_PREFIX) &&
                            !(name in FOREIGN_NAMESPACED)
                        ) {
                            const { line } = sf.getLineAndCharacterOfPosition(a0.getStart(sf));
                            violations.push({ name, file, line: line + 1, gate: fn });
                        }
                    }
                }
            }
            ts.forEachChild(node, walk);
        };
        walk(sf);
    }

    return { violations, callSites };
}

module.exports = {
    EVENT_GATES,
    DOMAIN_PREFIX,
    FOREIGN_NAMESPACED,
    collectNamespacedEventLiterals,
};
