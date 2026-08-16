/*!
 * GeoLeaf Offline UI — les signaux du MOTEUR, rendus visibles
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Écoute les signaux que le moteur hors-ligne émet et que personne n'entendait (B-72).
 *
 * ## Pourquoi ce module existe
 *
 * Le moteur émettait huit signaux ; l'interface en écoutait cinq. Les trois orphelins étaient
 * **la disponibilité de la base, le dépassement de quota et l'éviction par budget** — mesurés
 * à la clôture du Sprint 3, et arbitrés dès le 02/08 : ce sont **exactement** ceux dont les
 * tâches 3.4 (magasin non évinçable) et 3.13 (arbitrage du cache de tuiles) ont besoin pour
 * être **observables**. Un moteur qui gère le quota sans jamais le dire ne se distingue pas,
 * de l'extérieur, d'un moteur qui ne le gère pas.
 *
 * ⚠️ **`geoleaf:storage:ready` n'est PAS écouté ici — il a été SUPPRIMÉ du moteur.** Il
 * n'avait aucune charge utile et partait à **chaque** ouverture de base, donc à chaque
 * démarrage : une notification par boot est du bruit, et un écouteur qui ne ferait que
 * journaliser aurait fermé le compteur C2 à la lettre sans rien apporter. La règle du dépôt
 * est « un émetteur sans écouteur se supprime **ou** se consomme » — celui-là se supprimait.
 * ⚠️ Et sur iOS, l'état qui compte n'est pas « la base s'ouvre » mais « la base a été
 * **purgée** », que ce signal ne disait pas.
 *
 * ## Les deux tons, et pourquoi ils diffèrent
 *
 * | Signal | Ton | Motif |
 * |---|---|---|
 * | `storage:quota-exceeded` | **erreur** | le navigateur a REFUSÉ une écriture : la prochaine saisie peut ne pas tenir. C'est le plus grave des trois sur un appareil de terrain |
 * | `cache:evicted` | **avertissement** | des données que l'utilisateur avait demandé à télécharger ne sont plus là. ⚠️ **Jamais du travail non synchronisé** — la règle dure du contrat l'interdit, et `features` est INATTEIGNABLE à l'éviction — mais ce qu'il perd, il l'avait demandé, et il doit le savoir **avant** de partir hors réseau |
 *
 * ## Ce que ce module ne fait PAS
 *
 * Il ne corrige rien et ne décide rien : il rend audible ce que le moteur dit déjà. Si un hôte
 * charge le moteur sans cette interface, il n'entend rien — ce qui se tient, puisqu'il n'a
 * alors aucune interface hors-ligne du tout.
 */

import { getUINotifications, tLabel as t } from "@geoleaf/host-runtime";
import { formatFileSize } from "../utils/core-utils.js";

/** Détail porté par `geoleaf:storage:quota-exceeded` (`db/layers.ts`). */
interface QuotaExceededDetail {
    /** Clé de l'enregistrement que le navigateur a refusé d'écrire. */
    id?: string;
    /** Taille, en octets, de ce qu'on tentait d'écrire. */
    size?: number;
}

// 🛑 B-163 — `EvictedDetail` et `EVICTED_MS` sont partis avec l'écouteur d'éviction.
// Le contrat du détail est désormais `GeoLeafCacheEvictedDetail`
// (`core/src/contracts/event-bus.contract.ts`), lu par `kernel/storage/eviction-notice.ts`.
// Ce qu'ils documentaient sur les DEUX producteurs — la Cache API ne renseigne pas
// `freedBytes` — est repris dans l'en-tête de ce fichier-là, là où le rendu se décide.

/** Durée d'affichage du refus d'écriture. */
const QUOTA_MS = 8000;

// ⚠️ `formatFileSize` et NON un formateur local. J'en avais écrit un — vingt lignes de
// division par 1024 — avant de mesurer que ce paquet en expose déjà trois
// (`utils/core-utils.ts` : `formatFileSize`, `toMB`, `toGB`), qui délèguent aux formateurs du
// core par le seam. Un quatrième aurait été un doublon structurel créé le jour même où la
// tranche précédente en soldait un (les trois `getStorageQuota`). ⚠️ Il rend `""` quand la
// mesure manque — c'est ce que les appels ci-dessous testent avant d'afficher.

/** Les écouteurs posés, pour pouvoir les retirer — un plugin qui se démonte ne laisse rien. */
let _detach: Array<() => void> = [];

/**
 * Branche les écouteurs sur `document`. Idempotent : un second appel remplace le premier.
 *
 * @example
 * wireEngineSignals();
 */
export function wireEngineSignals(): void {
    unwireEngineSignals();

    const onQuota = (event: Event) => {
        const detail = (event as CustomEvent<QuotaExceededDetail>).detail ?? {};
        const size = formatFileSize(detail.size);
        // ⚠️ Le message NOMME la taille quand elle est connue, et se tait sinon. Une
        // notification qui affiche « undefined » est pire que celle qui n'affiche rien : elle
        // apprend à l'utilisateur à ne plus les lire.
        const base = t("storage.notif.quotaExceeded");
        getUINotifications()?.error?.(size ? `${base} (${size})` : base, QUOTA_MS);
    };

    // 🛑 B-163 — L'ÉCOUTEUR D'ÉVICTION A ÉTÉ REMONTÉ DANS LE CORE, il n'est plus ici.
    //
    // Il vivait dans ce fichier, et c'était le SEUL du dépôt : sur `deploy-core`, qui n'embarque
    // pas ce plugin, l'alerte partait donc dans le vide. Elle est désormais rendue par
    // `kernel/storage/eviction-notice.ts`, sur un chemin de boot inconditionnel — donc sur
    // TOUTES les variantes, et pour les deux émetteurs (le pont SW et `cache-manager`, ce
    // dernier hors PWA).
    //
    // ⚠️ Ne pas le rétablir « pour l'UI riche » : les deux écouteurs afficheraient DEUX toasts
    // sur `deploy-full`. C'est le nombre d'écouteurs qui était à zéro sur une variante, pas le
    // nombre d'émetteurs qui était à corriger.
    //
    // 🖐 Le quota, lui, RESTE ICI : `geoleaf:storage:quota-exceeded` est émis par le
    // `db/layers.ts` de ce plugin — celui qui écrit dans IndexedDB. Cette moitié n'a aucun
    // émetteur in-core, donc rien à remonter.
    document.addEventListener("geoleaf:storage:quota-exceeded", onQuota);
    _detach = [() => document.removeEventListener("geoleaf:storage:quota-exceeded", onQuota)];
}

/**
 * Retire les écouteurs posés par {@link wireEngineSignals}.
 *
 * ⚠️ **EXPORTÉE POUR LE HARNAIS, et le relevé C1 de la tâche 8.8 s'y est trompé.**
 * Le balayage d'exports orphelins l'a signalée sans consommateur de production — c'est exact :
 * `entry.ts:104` appelle `wireEngineSignals()` au chargement et le plugin n'a aucun chemin de
 * démontage. **Mais elle a un consommateur de TEST** (`__tests__/engine-signals.test.js`, cas
 * « le décâblage retire réellement les écouteurs »), et la dé-exporter a fait rougir **7 cas**
 * immédiatement.
 *
 * C'est la **classe D** du relevé — « seams de test : le corpus exclut `__tests__` par
 * conception » —, pas la classe A. Le geste juste est donc de la garder exportée avec ce
 * motif écrit ici : dé-exporter aurait retiré la seule couverture du décâblage pour refermer
 * une surface que personne n'appelait de toute façon. **« Mort » ne veut pas dire
 * « jetable »**, et ce cas est le rappel que le balayage seul ne tranche pas.
 *
 * 🛑 Si un démontage de plugin apparaît un jour, c'est LUI qui devra l'appeler : un écouteur
 * posé sur `document` sans jamais être retiré est une fuite, et l'existence de cette fonction
 * ne la répare pas tant qu'aucun code de production ne l'invoque.
 */
export function unwireEngineSignals(): void {
    for (const off of _detach) off();
    _detach = [];
}
