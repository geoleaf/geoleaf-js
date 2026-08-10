/*!
 * @geoleaf-plugins/editor — Offline sync replay (autonomous)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Replays the editor's own `editor.*` entries from the shared Storage sync queue
 * when the browser comes back online. The plugin owns its full offline lifecycle:
 * plugin-storage exposes no generic replay dispatcher and addpoi's handler is
 * POI-only, so editor entries would otherwise never flush. Each queued op is
 * replayed through the online adapter (which already fires the conflict event on
 * a 409); successes are removed from the queue, failures stay `pending`/`failed`.
 *
 * The Storage façade is read at call time (`globalThis.GeoLeaf.Storage`).
 * https://geoleaf.dev
 */
import { _getLabel, _notify } from "../internal.js";
import { type EditorPersistenceAdapter } from "./adapter-interface.js";
import { storageDb, storageFacade } from "./storage-seam.js";
import { dispatchEditorEvent } from "../editor-events.js";

/** A pending editor queue entry as read back from Storage. */
/**
 * Une entrée d'`outbox`, telle que la modale d'attente la lit.
 *
 * ⚠️ `type` et `payload` ont disparu avec le vocabulaire v3 : l'entrée porte `kind` et ne
 * référence que `[layerId, localId]` — la charge utile vit dans le magasin `features`.
 */
export interface EditorQueueEntry {
    id: string;
    kind: string;
    layerId: string;
    localId: string;
    state?: string;
    createdAt?: number;
}

/** Collaborators injected by entry.ts. */
interface SyncReplayDeps {
    /** Online adapter used to replay queued ops (REST or collection). */
    rest: EditorPersistenceAdapter;
    /** Called after a flush so the UI (pending badge) can refresh. */
    onChange?: () => void;
}

let _deps: SyncReplayDeps | null = null;
let _onlineListener: (() => void) | null = null;
let _flushing = false;

/**
 * Les entrées en attente, lues dans l'`outbox` du core.
 *
 * 🛑 **TÂCHE 4.9 — IL N'Y A PLUS DE « ENTRÉES DE L'ÉDITEUR ».** Cette fonction filtrait sur le
 * préfixe `editor.` pour ne garder que les siennes, dans une file que deux plugins écrivaient
 * avec deux vocabulaires. L'`outbox` n'en parle qu'un — et un plugin n'a plus à reconnaître
 * « les siennes » : ce sont les entités de l'utilisateur, pas celles d'un producteur.
 *
 * ⚠️ **Conséquence assumée : la modale d'attente liste désormais TOUT ce qui est dû au
 * serveur**, y compris ce qui vient d'`addpoi`. C'est plus juste que l'ancien comportement —
 * un utilisateur qui demande « qu'est-ce qui n'est pas encore parti ? » veut la réponse
 * complète, pas la part d'un plugin qu'il ne sait pas nommer.
 *
 * @returns Les entrées dues au serveur, dans l'ordre d'insertion.
 */
export async function listPendingEditorEntries(): Promise<EditorQueueEntry[]> {
    const outbox = storageDb()?._ensureModule?.("Outbox");
    if (!outbox?.list) return [];
    const all = await outbox.list();
    return all.filter((e) => e.state !== "synced");
}

/** Number of editor operations currently pending in the queue. */
export async function getPendingCount(): Promise<number> {
    return (await listPendingEditorEntries()).length;
}

/**
 * Replays a single queued op through the online adapter.
 *
 * Throws `PersistenceError("parse")` on any entry it cannot replay — an unknown
 * `type`, a save/update with no `feature`, a delete with no `featureId`. This is
 * load-bearing: until PLUGINS S4 the uncovered branches fell through and returned
 * normally, so `_syncOneEntry` read them as a success and called
 * `removeSyncQueueEntry` — a malformed offline op was dropped from the queue and
 * reported to the user as synced. Throwing routes them to the `failed` path
 * instead, where they stay visible in the pending badge and can be inspected.
 */
/**
 * Draine la file vers le serveur.
 *
 * 🛑 **TÂCHE 4.9 — CE CORPS EST DEVENU UNE DÉLÉGATION.** Il rejouait lui-même chaque entrée à
 * travers l'adaptateur REST du plugin : lecture de la charge dans `payload`, dispatch sur le
 * vocabulaire `editor.*`, gestion du 409. Les trois vivent désormais dans le core — le drain
 * (4.5) porte l'identité cliente sur le fil et réconcilie `localId → serverId`, et la
 * détection de conflit (4.6) est faite par un filtre sur le marqueur de fraîcheur, pas par un
 * en-tête `X-Force-Update` qu'aucun serveur ne lit.
 *
 * ⚠️ **La surface est conservée** : `entry.ts` appelle `flushNow` au retour du réseau, et la
 * modale d'attente s'en sert. Changer la signature aurait éteint le rejeu en silence.
 */
export async function flushNow(): Promise<void> {
    if (!_deps) return;
    await drainOutbox();
}

/** Le décompte rendu par le drain du core, tel que les consommateurs le lisent. */
export interface DrainReport {
    attempted: number;
    pushed: number;
    failed: number;
    conflicts: number;
}

/**
 * Draine l'outbox et REND le décompte.
 *
 * 🛑 **Ce corps a été extrait de {@link flushNow} à la tâche 5.1-b, et le motif est le
 * verrou.** Le handler `"poi"` du seam `Sync` doit lui aussi drainer, pour le bouton de rejeu
 * d'`offline-ui`. S'il appelait `pushOutbox` de son côté, deux drains pourraient se recouvrir :
 * `_flushing` ne garde que ce qui passe **par ici**. Un seul point d'entrée, un seul verrou.
 *
 * ⚠️ **Le récepteur est obligatoire — B-128.** `pushOutbox` lit `this._modules` sur la façade
 * du core ; l'appeler détaché jette `TypeError … reading '_modules'`. Le même défaut vivait
 * dans `storage-queue-adapter.ts`, où il rendait la sauvegarde hors ligne muette. Aucun
 * typecheck ne l'attrape : ce plugin redéclare la surface qu'il attend, et une méthode
 * redéclarée perd la contrainte de `this` que le core exprime. `facade.pushOutbox()` est un
 * appel de MÉTHODE — le récepteur y est lié par construction, et il doit le rester.
 *
 * @returns le décompte, ou `null` quand le drain n'a pas eu lieu (hors réseau, drain déjà en
 *   cours, ou façade de stockage absente). ⚠️ `null` n'est PAS `{pushed: 0}` : le premier dit
 *   « rien n'a été tenté », le second « tenté, rien n'est parti ».
 */
export async function drainOutbox(): Promise<DrainReport | null> {
    if (_flushing) return null;
    // Rejouer hors réseau ferait échouer chaque entrée ; on attend la reconnexion.
    if (typeof navigator !== "undefined" && !navigator.onLine) return null;
    const facade = storageFacade();
    if (!facade?.pushOutbox) return null;

    _flushing = true;
    try {
        const report = await facade.pushOutbox();
        if (report.pushed > 0 || report.failed > 0) {
            _dispatchFlushed(report);
            _deps?.onChange?.();
        }
        return report;
    } finally {
        _flushing = false;
    }
}

/**
 * Émet `geoleaf:editor:feature-sync-flushed` une fois par DRAIN, plus une fois par entrée.
 *
 * 🛑 **CET ÉVÉNEMENT A UN ÉCOUTEUR, ET J'AI FAILLI LE SUPPRIMER SUR UNE MESURE QUE JE N'AVAIS
 * PAS FAITE.** Une première rédaction le retirait en affirmant « aucun écouteur dans le dépôt,
 * mesuré ». Le grep, lancé APRÈS, a rendu `entry.ts:291` — `_onQueueChanged`, qui rafraîchit le
 * badge d'attente — et un test qui l'asserte. Le retirer aurait figé le badge en silence après
 * chaque rejeu.
 *
 * La granularité change, elle : le drain du core rend un décompte, pas une liste d'entrées. Un
 * événement par drain suffit à ce que l'écouteur fait — il ne lit que le fait qu'il s'est passé
 * quelque chose.
 *
 * @param report - Le décompte rendu par le drain.
 */
function _dispatchFlushed(report: { pushed: number; failed: number }): void {
    dispatchEditorEvent("geoleaf:editor:feature-sync-flushed", {
        pushed: report.pushed,
        failed: report.failed,
    });
}

/**
 * Registers the `online` listener and attempts an initial flush. Idempotent: a
 * second call replaces the stored deps without stacking listeners.
 */
export function initSyncReplay(deps: SyncReplayDeps): void {
    _deps = deps;
    if (typeof window === "undefined") return;
    if (!_onlineListener) {
        _onlineListener = () => {
            void flushNow();
        };
        window.addEventListener("online", _onlineListener);
    }
    // Opportunistic flush at init when already online (e.g. queue left from a prior session).
    if (typeof navigator === "undefined" || navigator.onLine) {
        void flushNow();
    }
}

/** Removes the `online` listener and resets module state. */
export function destroySyncReplay(): void {
    if (_onlineListener && typeof window !== "undefined") {
        window.removeEventListener("online", _onlineListener);
    }
    _onlineListener = null;
    _deps = null;
    _flushing = false;
}
