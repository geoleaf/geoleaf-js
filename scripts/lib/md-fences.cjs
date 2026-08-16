/*!
 * GeoLeaf — outillage de gates
 * © 2026 Mattieu Pottier · MIT
 */

/**
 * @file md-fences.cjs
 * @description Suivi d'état des blocs de code Markdown, conforme à CommonMark. B-153 ①.
 *
 * ## 🛑 CE QUE LA BASCULE AVEUGLE SE TROMPAIT À FAIRE
 *
 * `check-dead-links.cjs` portait, **à deux endroits**, la même ligne :
 *
 * ```js
 * if (/^```/.test(ln.trim())) { inCodeBlock = !inCodeBlock; continue; }
 * ```
 *
 * Elle bascule sur **n'importe quelle** ligne commençant par trois backticks — donc aussi sur
 * un fence **imbriqué**. CommonMark dit l'inverse : un bloc ouvert par N backticks ne se ferme
 * que par un marqueur d'**au moins N** backticks, et **sans chaîne d'information**. C'est
 * précisément ce qui autorise un exemple de Markdown à l'intérieur d'un bloc de Markdown.
 *
 * ## ⚠️ LE GISEMENT EST NUL AUJOURD'HUI, ET C'EST LE RÉSULTAT DE LA MESURE
 *
 * Balayage du 16/08/2026 sur les **133 fichiers** du corpus gaté, ancien classement contre
 * nouveau : **0 fichier change, 0 ligne change**. Aucun document n'exerce le défaut à ce jour.
 *
 * 🛑 **Et une hypothèse a été démentie en chemin, ce qui vaut d'être écrit.**
 * `packages/core/docs/CORE_EXTENSION_GUIDE.md` ouvre bien un bloc à **quatre** backticks
 * contenant une paire à trois — le cas d'école. Il ne mord pourtant ni avant ni après :
 * les fences imbriqués y sont **préfixés par ` * `**, étant à l'intérieur d'un commentaire
 * TSDoc, donc aucun des deux motifs ne les voit. **Un exemple qui ressemble au défaut n'est pas
 * une instance du défaut** ; seul le balayage complet le dit.
 *
 * ✅ **La correction reste juste, et sa valeur est double** : la bascule était fausse au regard
 * de CommonMark — donc le premier document qui imbriquera un fence produira un verdict faux sans
 * que rien ne relie la cause à l'effet — et le motif était **dupliqué**, si bien que corriger un
 * site aurait laissé l'autre. Éprouvée sur un cas synthétique : un bloc ```` ouvrant, contenant
 * un ```js et son ``` de fermeture, puis du contenu. L'ancien classe ce contenu en PROSE, le
 * nouveau en CODE.
 *
 * ## ⚠️ CE QUE CE MODULE NE FAIT PAS
 *
 * Il ne construit pas un analyseur Markdown. Il ne connaît ni les blocs **indentés** de quatre
 * espaces, ni les fences à l'intérieur d'une citation `>`. Le corpus n'en porte aucun cas
 * mesuré — et le dire ici vaut mieux que de laisser croire à une conformité totale.
 */
"use strict";

/** Ouverture de fence : marqueur (≥3 backticks OU ≥3 tildes) + chaîne d'information libre. */
const FENCE_RE = /^(`{3,}|~{3,})(.*)$/;

/**
 * Suivi d'état des blocs de code, à créer une fois par fichier.
 *
 * @example
 * const fences = createFenceTracker();
 * for (const line of lines) {
 *     if (fences.consume(line)) continue; // ligne de marqueur
 *     if (fences.inCode) continue;        // contenu de bloc
 *     // … ici, on est dans de la PROSE
 * }
 *
 * @returns {{ inCode: boolean, consume(line: string): boolean }}
 */
function createFenceTracker() {
    /** Marqueur ayant ouvert le bloc courant — `null` hors bloc. */
    let openMarker = null;

    return {
        get inCode() {
            return openMarker !== null;
        },

        /**
         * Traite une ligne. Rend `true` si c'est une ligne de MARQUEUR (à sauter par
         * l'appelant), `false` si c'est une ligne ordinaire — dont il faut alors lire
         * `inCode` pour savoir si elle est du code ou de la prose.
         *
         * @param {string} line
         * @returns {boolean}
         */
        consume(line) {
            const m = FENCE_RE.exec(line.trim());
            if (!m) return false;

            const [, marker, info] = m;

            if (openMarker === null) {
                // Ouverture. La chaîne d'information n'appartient qu'à l'ouverture.
                openMarker = marker;
                return true;
            }

            // 🛑 FERMETURE CONDITIONNELLE — c'est tout le correctif de B-153 ①.
            // Même caractère, longueur AU MOINS égale, et aucune chaîne d'information.
            // Un ``` rencontré dans un bloc ouvert par ```` n'est pas une fermeture :
            // c'est du contenu, et le traiter comme une fermeture inverse le classement
            // de tout ce qui suit jusqu'au prochain marqueur.
            const sameKind = marker[0] === openMarker[0];
            if (sameKind && marker.length >= openMarker.length && info.trim() === "") {
                openMarker = null;
            }
            return true;
        },
    };
}

module.exports = { createFenceTracker, FENCE_RE };
