/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Les DEUX sorties de quarantaine — tâche 8.4 (B-123).
 *
 * 🛑 **Une entrée en quarantaine n'en avait AUCUNE.** Ni le drain
 * (`REPLAYABLE_STATUSES` = `failed` + `pending`), ni la purge, ni aucun geste d'interface ne
 * pouvait l'en sortir. Elle était comptée (`getSyncCounts().quarantinedCount`), listée
 * (`listPendingEdits`) et exportable — mais l'opérateur de terrain la voyait s'accumuler sans
 * pouvoir rien en faire. « Jamais détruite » protégeait la saisie et condamnait l'opérateur à
 * la porter indéfiniment.
 *
 * Deux sorties, arbitrées par Mattieu le 07/08/2026, et **chacune couvre la moitié qui lui
 * correspond** — parce que les cinq motifs ne sont pas de même nature :
 *
 * | Motif | La cause peut-elle être constatée levée ? |
 * | --- | --- |
 * | `retryBudgetExhausted` | **oui** — le serveur n'a jamais répondu, le réseau peut revenir |
 * | `layerNoLongerWritable` | **oui** — et c'est VÉRIFIABLE : la couche a-t-elle un `write` ? |
 * | `notImplementedByServer` | **oui** — le serveur peut être mis à jour (B-199) |
 * | `deletedOnServer` | non — rejouer recréerait ce que le serveur a supprimé |
 * | `rejectedByServer` | non — le contrat le définit comme « replay cannot fix » |
 *
 * ⚠️ Un « réessayer » indifférencié aurait donc été faux pour une part des cas, et faux dans
 * le sens qui coûte : il aurait recréé des entités supprimées côté serveur.
 *
 * ⚠️ **Cette table a compté QUATRE motifs jusqu'au 09/08/2026, et sa dernière ligne était plus
 * large que ce qu'elle croyait dire (B-199).** `rejectedByServer` nommait alors tout échec
 * non-409/non-404 — un 503 de maintenance y compris. La ligne « non — replay cannot fix » était
 * donc exacte sur le motif et fausse sur les entrées qui le portaient : une panne serveur
 * transitoire n'avait, en pratique, que la sortie par destruction. Le correctif est en amont,
 * dans la classification de `push-engine.ts` ; ce module n'a gagné qu'une ligne.
 *
 * 🛑 **Ce qui reste interdit** : un plafond de rétention, un balayage de purge, ou tout chemin
 * qui retire une entrée sans qu'un humain ait vu exactement ce qui est retiré. C'est ce que
 * `ServerDeletionPolicy` défend, et l'amendement de 8.4 ne l'a pas élargi — il l'a NOMMÉ :
 * ce que le contrat interdit est la perte que l'opérateur n'a pas vue.
 *
 * @version 3.0.0
 */

import { Log } from "../../../utils/log/index.js";
import { StorageContract } from "../../../kernel/shared/index.js";
import { coreProfileLayerConfig } from "../config-seam.js";
import type { QuarantineReason } from "../../../contracts/sync.contract.js";

/** Une entrée de file, réduite à ce que ce module lit. */
interface QuarantinedEntry {
    id: string;
    layerId?: string;
    localId?: string;
    state?: string;
    quarantine?: QuarantineReason;
    attempts?: number;
}

/** Le module de file, réduit à ce que ce module lit et écrit. */
interface OutboxModule {
    list(): Promise<QuarantinedEntry[]>;
    updateState(
        id: string,
        state: string,
        patch?: {
            attempts?: number;
            quarantine?: QuarantineReason | null;
            quarantineStatus?: number | null;
        }
    ): Promise<void>;
    remove(id: string): Promise<void>;
}

interface QuarantineStore {
    _ensureModule?: (name: string) => unknown;
}

/**
 * Les motifs dont la cause peut être CONSTATÉE levée.
 *
 * ⚠️ Dérivée du sens de chaque motif, pas d'une commodité : les deux autres nomment un fait
 * du serveur qu'aucun geste local ne défait.
 */
const REQUEUEABLE: readonly QuarantineReason[] = [
    "retryBudgetExhausted",
    "layerNoLongerWritable",
    "notImplementedByServer",
];

/**
 * Ce que le refus d'une sortie rend, pour que l'appelant sache POURQUOI.
 *
 * ⚠️ NON exportés, ces deux types : ils ne sont nommés nulle part ailleurs — la façade
 * déclare sa propre forme structurelle (`StorageQuarantineOutcome`), parce qu'elle vit dans
 * le graphe de boot et l'édition dans le chunk différé. Les exporter aurait ajouté deux noms
 * publics que personne n'appelle, et `check-orphan-exports` les a rendus en deux régressions
 * à la pose. Même arbitrage qu'`AttributeCaptureWidget` (7.2) et que les dix formes de charge
 * d'événement (7.3).
 */
type QuarantineRefusal =
    | "engineUnavailable"
    | "notFound"
    | "notQuarantined"
    | "causeNotLiftable"
    | "causeStillPresent"
    | "confirmationMismatch";

/** Le compte rendu d'une tentative de sortie. Non exporté — voir {@link QuarantineRefusal}. */
interface QuarantineOutcome {
    ok: boolean;
    refused?: QuarantineRefusal;
}

/** Résout le module de file, ou `null` si le moteur n'est pas câblé. */
function _outbox(): OutboxModule | null {
    const db = StorageContract.DB as QuarantineStore | null;
    const mod = db?._ensureModule?.("Outbox") as Partial<OutboxModule> | null | undefined;
    // ⚠️ `typeof … === "function"` et non la vérité du membre : sous un type non optionnel,
    // `mod?.list && …` est toujours vrai pour `tsc`, qui le signale (TS2774). Le module vient
    // d'un registre à clé-string — il PEUT manquer, et c'est ce cas-là qu'on garde.
    return typeof mod?.list === "function" && typeof mod?.updateState === "function"
        ? (mod as OutboxModule)
        : null;
}

/** Retrouve une entrée EN QUARANTAINE par son identifiant. */
async function _findQuarantined(
    outbox: OutboxModule,
    id: string
): Promise<QuarantinedEntry | QuarantineRefusal> {
    const entry = (await outbox.list()).find((e) => e.id === id);
    if (!entry) return "notFound";
    if (entry.state !== "quarantined") return "notQuarantined";
    return entry;
}

/**
 * La cause d'une quarantaine est-elle levée ?
 *
 * `layerNoLongerWritable` est le seul motif dont la levée est OBSERVABLE ici : la couche
 * a-t-elle retrouvé une cible d'écriture ? On le vérifie plutôt que de le croire — remettre
 * en file une entrée dont la couche n'écrit toujours pas la renverrait en quarantaine au
 * premier drain, en consommant son budget pour rien.
 *
 * `retryBudgetExhausted` ne nomme aucun fait vérifiable localement : le serveur n'a jamais
 * répondu. Le geste de l'opérateur EST l'observation — c'est lui qui sait que le réseau est
 * revenu. On le croit, et on remet son budget à zéro.
 *
 * `notImplementedByServer` est du même bord depuis B-199, et pour la même raison : la levée de
 * cause est le déploiement d'une version de serveur qui connaît le verbe. Rien ici ne peut le
 * constater — le seul moyen serait de refaire l'appel, c'est-à-dire le rejeu lui-même.
 *
 * @param entry - L'entrée en quarantaine.
 * @returns `true` si la cause est levée (ou invérifiable et donc confiée à l'opérateur).
 */
function _causeIsLifted(entry: QuarantinedEntry): boolean {
    if (entry.quarantine !== "layerNoLongerWritable") return true;
    const cfg = coreProfileLayerConfig(entry.layerId ?? "") as { write?: { enabled?: boolean } };
    return cfg?.write?.enabled === true;
}

/**
 * Remet une entrée en quarantaine dans la file, quand sa cause est levée.
 *
 * L'entrée repasse en `pending` et son compteur d'essais est **remis à zéro** : sans ça, elle
 * retomberait en quarantaine au premier échec, puisque son budget est déjà épuisé — c'est
 * précisément ce qui l'y a mise.
 *
 * @param id - Identifiant de contrat de l'entrée.
 * @returns Le compte rendu ; `refused` dit pourquoi quand la sortie n'a pas eu lieu.
 *
 * @example
 * ```ts
 * const out = await requeueQuarantined("create:sites:loc:abc:1");
 * if (!out.ok) console.warn(out.refused); // "causeStillPresent", par exemple
 * ```
 */
export async function requeueQuarantined(id: string): Promise<QuarantineOutcome> {
    const outbox = _outbox();
    if (!outbox) return { ok: false, refused: "engineUnavailable" };

    const found = await _findQuarantined(outbox, id);
    if (typeof found === "string") return { ok: false, refused: found };

    const reason = found.quarantine;
    if (!reason || !REQUEUEABLE.includes(reason)) {
        // `deletedOnServer` et `rejectedByServer` : rejouer recréerait une entité supprimée,
        // ou se ferait refuser à l'identique. Leur sortie est `discardQuarantined`.
        // ⚠️ Ce refus ne vaut que parce que `rejectedByServer` ne nomme QUE des refus définitifs
        // depuis B-199 — tant qu'il portait aussi les 5xx, il condamnait des pannes passagères.
        return { ok: false, refused: "causeNotLiftable" };
    }
    if (!_causeIsLifted(found)) return { ok: false, refused: "causeStillPresent" };

    // 🛑 B-200 — `quarantineStatus` s'efface AVEC le motif, jamais après. Une entrée remise en
    // file qui garderait « 403 » porterait un diagnostic périmé sur un rejeu qui n'a pas encore
    // eu lieu — exactement le genre de fait faux que cette ligne existe pour empêcher, et il
    // serait plus trompeur qu'une absence puisqu'il a l'air d'une mesure.
    await outbox.updateState(id, "pending", {
        attempts: 0,
        quarantine: null,
        quarantineStatus: null,
    });
    Log.info(`[Offline.Quarantine] ${id} — remise en file (cause « ${reason} » levée).`);
    return { ok: true };
}

/**
 * Détruit une entrée en quarantaine, sur confirmation EXPLICITE de l'opérateur.
 *
 * 🛑 **La confirmation n'est pas un booléen, et c'est le cœur du geste.** L'appelant doit
 * fournir le `localId` de l'entrée — une valeur qu'il ne peut connaître qu'en l'ayant LISTÉE.
 * Un `{ confirmed: true }` se pose depuis n'importe quel code sans que rien n'ait été montré ;
 * cette forme-ci rend structurellement vrai le fait que la saisie a été énumérée avant d'être
 * jetée. C'est ce que `ServerDeletionPolicy` exige depuis son amendement de 8.4 : ce que le
 * contrat interdit est la perte que l'opérateur n'a pas VUE, pas la destruction en elle-même.
 *
 * @param id - Identifiant de contrat de l'entrée.
 * @param confirmedLocalId - Le `localId` de cette entrée, tel que l'appelant l'a lu.
 * @returns Le compte rendu ; `confirmationMismatch` si la confirmation ne correspond pas.
 *
 * @example
 * ```ts
 * const [entry] = (await GeoLeaf?.Storage?.listPendingEdits?.()) ?? [];
 * // Les gardes ne sont pas décoratives : la façade peut ne pas être montée et la file peut
 * // être vide. Cet exemple est COMPILÉ — c'est la gate `typecheck-docs-examples` qui l'a dit.
 * if (entry) await discardQuarantined(entry.id, entry.localId); // il a vu ce qu'il jette
 * ```
 */
export async function discardQuarantined(
    id: string,
    confirmedLocalId: string
): Promise<QuarantineOutcome> {
    const outbox = _outbox();
    if (!outbox?.remove) return { ok: false, refused: "engineUnavailable" };

    const found = await _findQuarantined(outbox, id);
    if (typeof found === "string") return { ok: false, refused: found };

    if (!confirmedLocalId || confirmedLocalId !== found.localId) {
        return { ok: false, refused: "confirmationMismatch" };
    }

    await outbox.remove(id);
    Log.warn(
        `[Offline.Quarantine] ${id} — DÉTRUITE sur confirmation (motif « ${found.quarantine} »). ` +
            "La saisie a été énumérée avant d'être jetée ; elle n'est pas récupérable."
    );
    return { ok: true };
}
