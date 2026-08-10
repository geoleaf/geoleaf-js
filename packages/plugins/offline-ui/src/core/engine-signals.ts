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

/**
 * Détail porté par `geoleaf:cache:evicted`.
 *
 * ⚠️ **DEUX producteurs depuis la tâche 1.4**, et leurs détails ne portent pas la même chose :
 *   · IndexedDB (`db/eviction.ts` via `_enforceCacheQuota`) — `EvictionResult` complet, octets
 *     compris, comptes exprimés en OCTETS ;
 *   · Cache API (le Service Worker, relayé par `kernel/storage/sw-register.ts`) — **pas de
 *     `freedBytes`** : la Cache API n'expose la taille d'aucune entrée, et `totalBefore` /
 *     `totalAfter` y comptent des ENTRÉES, pas des octets.
 *
 * C'est pourquoi `formatFileSize` est appelé sur une valeur possiblement absente plutôt que
 * sur un nombre supposé : il rend `""`, et l'avis se prononce alors sans taille. Fabriquer un
 * nombre pour homogénéiser les deux producteurs afficherait une quantité fausse.
 */
interface EvictedDetail {
    evicted?: number;
    freedBytes?: number;
    totalBefore?: number;
    totalAfter?: number;
    /** Quel magasin a évincé. Absent = IndexedDB, la forme historique. */
    store?: "indexeddb" | "cache-api";
    /** Pourquoi — seul le worker le renseigne. */
    reason?: "pressure" | "quota";
}

/** Durées d'affichage — le refus d'écriture reste plus longtemps que l'éviction. */
const QUOTA_MS = 8000;
const EVICTED_MS = 5000;

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

    const onEvicted = (event: Event) => {
        const detail = (event as CustomEvent<EvictedDetail>).detail ?? {};
        // 🛑 SORTIE EN TÊTE SI RIEN N'A ÉTÉ ÉVINCÉ. `_enforceCacheQuota` émet le signal
        // quand des enregistrements SONT retirés, mais un détail à zéro reste possible ; une
        // notification « 0 entrée retirée » entraîne exactement la même désaffection.
        const count = typeof detail.evicted === "number" ? detail.evicted : 0;
        if (count <= 0) return;
        const freed = formatFileSize(detail.freedBytes);
        const base = t("storage.notif.cacheEvicted").replace("{count}", String(count));
        getUINotifications()?.warning?.(freed ? `${base} (${freed})` : base, EVICTED_MS);
    };

    document.addEventListener("geoleaf:storage:quota-exceeded", onQuota);
    document.addEventListener("geoleaf:cache:evicted", onEvicted);
    _detach = [
        () => document.removeEventListener("geoleaf:storage:quota-exceeded", onQuota),
        () => document.removeEventListener("geoleaf:cache:evicted", onEvicted),
    ];
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
