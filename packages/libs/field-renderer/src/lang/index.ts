/*!
 * @geoleaf/field-renderer — catalogue de libellés intégré
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Les libellés `form.*` que la bibliothèque **possède** (décision **D6**, tâche 5.1c).
 *
 * 🛑 **CE CATALOGUE CORRIGE UNE INVERSION DE PROPRIÉTÉ, pas un rangement.** La bibliothèque
 * utilisait **43 clés `form.*` qu'elle ne déclarait nulle part** : elles vivaient dans les
 * dictionnaires d'`editor` et d'`addpoi`, c'est-à-dire chez ses consommateurs. Un hôte qui
 * chargeait la lib **seule** voyait donc `_getLabel` retomber sur **la clé brute** —
 * `form.error.imageSize` affiché tel quel à l'utilisateur.
 *
 * ⚠️ **Et la démonstration a été faite en acte deux fois pendant ce sprint** : les tâches
 * 5.1-d et 5.1-e ont dû écrire leurs clés neuves **dans les deux catalogues de plugins**,
 * faute de propriétaire.
 *
 * ⚠️ **La lecture reste opportuniste** — la lib ne dépend toujours pas de GeoLeaf. L'ordre est :
 * dictionnaire de l'hôte, puis ce catalogue, puis la clé. Un hôte garde donc le dernier mot sur
 * ses libellés, et la lib fonctionne seule.
 */
import fr from "./lang-fr.js";
import en from "./lang-en.js";
import es from "./lang-es.js";
import de from "./lang-de.js";
import it from "./lang-it.js";
import pt from "./lang-pt.js";

/** Les six locales du dépôt, indexées par code. */
const _CATALOGUE: Record<string, Record<string, string>> = { fr, en, es, de, it, pt };

/** Locale servie quand celle demandée est inconnue. */
export const FALLBACK_LANG = "fr";

/**
 * Cherche un libellé dans le catalogue intégré.
 *
 * ⚠️ Le repli sur {@link FALLBACK_LANG} est **par clé**, pas par locale : une locale qui
 * perdrait une clé rendrait le libellé français plutôt que la clé brute. Un mot dans la
 * mauvaise langue reste lisible ; `form.error.imageSize` ne l'est pas.
 *
 * @param key  - Clé `form.*`.
 * @param lang - Code de langue à deux lettres.
 * @returns le libellé, ou `undefined` quand la clé est inconnue partout.
 *
 * @example
 * ```ts
 * builtinLabel("form.error.imageSize", "en"); // "Image too large"
 * ```
 */
export function builtinLabel(key: string, lang: string): string | undefined {
    return _CATALOGUE[lang]?.[key] ?? _CATALOGUE[FALLBACK_LANG]?.[key];
}

/** @returns les codes de locale que le catalogue intégré porte. */
export function builtinLangs(): string[] {
    return Object.keys(_CATALOGUE);
}
