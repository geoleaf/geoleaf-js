/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Local Edit Module — l'écriture optimiste, et le seul écrivain de l'`outbox` (tâche 4.4).
 *
 * 🛑 **POURQUOI UN MODULE À LUI, ET PAS UNE MÉTHODE DE `features.ts` OU D'`outbox.ts`.**
 * L'invariant que cette tâche existe pour tenir est **inter-stores** : une saisie doit
 * atterrir dans `features` **et** dans l'`outbox`, ou dans aucun des deux. Écrite dans l'un
 * des deux modules, l'opération ouvrirait deux transactions successives — et un plantage
 * entre elles laisserait soit une saisie que rien ne poussera, soit un push qui ne trouvera
 * aucune entité. Les deux sont des pertes silencieuses, la classe même que la propriété 1 du
 * contrat interdit. Un invariant inter-stores ne peut vivre dans aucun store.
 *
 * ## La coalescence (reportée de 3.10, D1) — et pourquoi elle est triviale ici
 *
 * ⚠️ **L'entrée d'outbox ne porte PAS la charge utile.** Elle référence `localId`, et rien
 * d'autre (contrat : « It references `localId` and never `serverId` »). La charge est
 * **toujours** l'enregistrement courant de `features`. Conséquence directe : fusionner deux
 * éditions successives ne demande aucune fusion de données — il suffit de ne pas empiler une
 * seconde entrée. C'est cette forme qui rend le rejeu idempotent.
 *
 * | Déjà en file      | Nouvelle édition | Résultat                                             |
 * | ----------------- | ---------------- | ---------------------------------------------------- |
 * | `create`          | `update`         | reste `create` — il poussera l'état le plus récent   |
 * | `update`          | `update`         | reste `update`, une seule entrée                     |
 * | `create`          | `delete`         | **ANNULATION** — les deux disparaissent              |
 * | `update`          | `delete`         | devient `delete`                                      |
 * | rien              | n'importe        | une entrée neuve                                     |
 *
 * 🛑 **L'annulation efface AUSSI l'enregistrement `features`.** Une entité créée hors ligne
 * puis supprimée hors ligne n'a jamais existé côté serveur : garder sa trace produirait un
 * `DELETE` sur une identité que le serveur n'a jamais vue.
 *
 * ⚠️ **`inFlight` et `quarantined` ne coalescent JAMAIS.** Le premier est en cours de push —
 * le fusionner ferait diverger ce qui part sur le fil de ce que la file croit avoir envoyé.
 * Le second est mis de côté délibérément et **reste visible** : le fusionner l'effacerait.
 * `pending` et `failed` coalescent, parce que `failed` n'est pas terminal (contrat).
 *
 * @version 1.0.0
 */
"use strict";

import { Log } from "../../../utils/log/index.js";
import type {
    FeatureRecord,
    OutboxEntry,
    SyncOperationKind,
    VersionMarker,
} from "../../../contracts/sync.contract.js";

const FEATURES = "features";
const OUTBOX = "outbox";

/** États dont une entrée peut encore être fusionnée — voir le bandeau. */
const COALESCIBLE = new Set(["pending", "failed"]);

/** Une édition locale, telle que le seam la reçoit. */
export interface LocalEditInput {
    readonly layerId: string;
    readonly localId: string;
    readonly kind: SyncOperationKind;
    /** L'entité après édition. Ignorée pour un `delete`, qui conserve la version stockée. */
    readonly feature?: unknown;
    /** Marqueur sur lequel l'édition se fonde, renvoyé au push pour rendre le conflit détectable. */
    readonly baseVersion?: VersionMarker | null;
}

/** Ce que l'écriture optimiste a réellement fait. */
export interface LocalEditTally {
    readonly localId: string;
    /** Identifiant de l'entrée d'outbox qui porte cette édition, ou `null` si annulée. */
    readonly entryId: string | null;
    /** Vrai quand une entrée NEUVE a été empilée. Faux quand l'édition a fusionné. */
    readonly queued: boolean;
    /** Identifiant de l'entrée qui a absorbé cette édition, le cas échéant. */
    readonly coalescedInto: string | null;
    /** Vrai quand un `create` en attente et un `delete` se sont annulés. */
    readonly annulled: boolean;
}

/** Surface publique du module. */
export interface LocalEditDBInstance {
    /** Applique une édition localement ET la met en file, dans UNE transaction. */
    applyLocalEdit(input: LocalEditInput): Promise<LocalEditTally>;
    /** Identifiants d'entités portant une suppression en attente, pour une couche. */
    pendingDeletions(layerId: string): Promise<Set<string>>;
}

/**
 * Compteur monotone de frappe d'identifiants — la part que l'horloge ne peut pas fournir.
 *
 * 🛑 **`Date.now()` SEUL NE SUFFIT PAS, et c'est l'index UNIQUE qui l'a prouvé.** La première
 * rédaction composait `kind:layerId:localId:now` en affirmant que l'entité et l'instant
 * étaient « déjà uniques ensemble pour un écrivain mono-thread ». C'est faux : `Date.now()` a
 * une résolution à la milliseconde, et deux éditions de la même entité dans la même
 * milliseconde frappent le MÊME identifiant. La collision a fait JETER la transaction — le
 * comportement voulu (correctif B-03 : une collision lève au lieu d'écraser silencieusement),
 * mais sur un cas parfaitement légitime. Le défaut n'est apparu que sous la suite complète,
 * assez rapide pour que deux appels tombent dans la même milliseconde.
 */
let _mintCounter = 0;

/**
 * Identifiant d'entrée d'outbox — monotone par construction, jamais aléatoire.
 *
 * ⚠️ Pas de `Math.random()` : l'index `id` est **unique**, donc une collision jette. Un
 * identifiant tiré au sort rendrait cette garde probabiliste au lieu de la rendre inutile.
 * Le compteur, lui, ne peut pas collisionner dans un contexte mono-thread.
 *
 * @param input - L'édition en cours.
 * @param now - Horodatage de l'édition.
 * @returns Un identifiant unique, stable et lisible en journal.
 */
function mintEntryId(input: LocalEditInput, now: number): string {
    _mintCounter += 1;
    return `${input.kind}:${input.layerId}:${input.localId}:${now}-${_mintCounter}`;
}

/**
 * Initialise le module d'écriture optimiste.
 *
 * @param db - Une connexion IndexedDB ouverte.
 * @returns La surface publique du module.
 * @throws Quand `db` est absent.
 * @example
 * const edits = DBLocalEdit.init(db);
 * await edits.applyLocalEdit({ layerId: "sites", localId: "l1", kind: "update", feature });
 */
function init(db: IDBDatabase): LocalEditDBInstance {
    if (!db) {
        throw new Error("[DB.LocalEdit] Database instance is required");
    }

    return {
        applyLocalEdit(input) {
            return new Promise<LocalEditTally>((resolve, reject) => {
                const now = Date.now();
                const tx = db.transaction([FEATURES, OUTBOX], "readwrite");
                const features = tx.objectStore(FEATURES);
                const outbox = tx.objectStore(OUTBOX);

                let tally: LocalEditTally = {
                    localId: input.localId,
                    entryId: null,
                    queued: false,
                    coalescedInto: null,
                    annulled: false,
                };

                tx.oncomplete = () => resolve(tally);
                tx.onerror = () => reject(new Error(`[DB.LocalEdit] failed: ${tx.error}`));
                tx.onabort = () => reject(new Error(`[DB.LocalEdit] aborted: ${tx.error}`));

                // 1. Ce qui est déjà en file pour CETTE entité — l'index composé que 3.4 a posé
                //    pour ça, et la raison pour laquelle la coalescence n'a pas pu vivre sur
                //    `sync_queue` (elle y aurait exigé d'inférer l'identité par vocabulaire).
                const queued = outbox.index("localId").getAll([input.layerId, input.localId]);

                queued.onsuccess = () => {
                    const entries = (queued.result as (OutboxEntry & { seq: number })[]) ?? [];
                    const mergeable = entries.filter((e) => COALESCIBLE.has(e.state));
                    const pendingCreate = mergeable.find((e) => e.kind === "create");

                    // 2. ANNULATION — créé puis supprimé hors ligne : le serveur ne l'a jamais vu.
                    if (input.kind === "delete" && pendingCreate) {
                        for (const entry of mergeable) outbox.delete(entry.seq);
                        features.delete([input.layerId, input.localId]);
                        tally = { ...tally, annulled: true };
                        return;
                    }

                    // 3. L'enregistrement d'entité. Un `delete` CONSERVE le sien : c'est le seul
                    //    endroit où vit le `serverId`, et le push en a besoin pour savoir QUOI
                    //    supprimer — l'entrée d'outbox, elle, ne porte que le `localId`.
                    const existing = features.get([input.layerId, input.localId]);
                    existing.onsuccess = () => {
                        const current = existing.result as FeatureRecord | undefined;
                        const record: FeatureRecord = {
                            layerId: input.layerId,
                            localId: input.localId,
                            serverId: current?.serverId ?? null,
                            syncState: "pending",
                            updatedAt: now,
                            version:
                                input.baseVersion !== undefined
                                    ? input.baseVersion
                                    : (current?.version ?? null),
                            // 🛑 UNE ÉDITION PARTIELLE NE DÉTRUIT PAS CE QU'ELLE N'APPORTE PAS.
                            // Une modification d'attributs ne renvoie pas forcément la
                            // géométrie — mesuré : `updateExistingPoi` journalise « missing
                            // geometry » et met en file quand même. Écraser avec `undefined`
                            // ferait disparaître la position d'une entité que l'utilisateur
                            // voulait seulement renommer. La règle valait déjà pour les
                            // suppressions ; elle vaut pour toute édition.
                            feature: input.feature ?? current?.feature,
                        };
                        features.put(record);

                        // 4. La file. Une entrée fusionnable rend l'empilement inutile —
                        //    la charge étant l'enregistrement, elle est déjà à jour.
                        const absorber =
                            input.kind === "delete"
                                ? mergeable.find((e) => e.kind === "delete")
                                : mergeable[0];

                        if (absorber) {
                            tally = { ...tally, entryId: absorber.id, coalescedInto: absorber.id };
                            return;
                        }

                        // Un `delete` qui suit un `update` en attente REMPLACE cet update :
                        // pousser une modification puis une suppression est du travail pour rien,
                        // et la modification peut échouer sur une entité qui va disparaître.
                        if (input.kind === "delete") {
                            for (const entry of mergeable) outbox.delete(entry.seq);
                        }

                        const entry: OutboxEntry = {
                            id: mintEntryId(input, now),
                            kind: input.kind,
                            layerId: input.layerId,
                            localId: input.localId,
                            baseVersion: record.version,
                            state: "pending",
                            attempts: 0,
                            createdAt: now,
                        };
                        outbox.add(entry);
                        tally = { ...tally, entryId: entry.id, queued: true };
                    };
                };
            });
        },

        pendingDeletions(layerId) {
            return new Promise<Set<string>>((resolve, reject) => {
                const tx = db.transaction([OUTBOX], "readonly");
                const req = tx.objectStore(OUTBOX).getAll();
                req.onerror = () => reject(new Error(`[DB.LocalEdit] read failed: ${req.error}`));
                req.onsuccess = () => {
                    const entries = (req.result as OutboxEntry[]) ?? [];
                    resolve(
                        new Set(
                            entries
                                .filter(
                                    (e) =>
                                        e.layerId === layerId &&
                                        e.kind === "delete" &&
                                        e.state !== "quarantined"
                                )
                                .map((e) => e.localId)
                        )
                    );
                };
            });
        },
    };
}

Log.debug("[DB.LocalEdit] Module loaded");

/** Registry entry consumed by `db-modules-registry.ts`. */
export const DBLocalEdit = { init };
