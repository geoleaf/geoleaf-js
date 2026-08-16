/*!
 * GeoLeaf Core (offline capability) — Outbox push and identity reconciliation
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Push — le drain de l'`outbox`, et la réconciliation d'identité (tâche 4.5).
 *
 * 4.4 a donné à l'`outbox` son premier écrivain ; celle-ci lui donne son premier LECTEUR
 * réel. Le cycle est alors fermé : rapatrier (4.1) → lire local (4.3) → éditer hors réseau
 * (4.4) → repousser au retour du réseau (ici).
 *
 * ## Ce qui rend le rejeu idempotent, et pourquoi ce n'était pas possible avant
 *
 * 🛑 **L'identité CLIENTE part sur le fil.** Le corps porte `local_id`, hors de la liste
 * blanche de propriétés — les colonnes métier appartiennent au formulaire, celle-ci
 * appartient au protocole. C'est ce qui permet au SERVEUR de refuser un doublon lui-même :
 * mesuré sur le backend de preuve, un rejeu du même `local_id` rend **409** sur une
 * contrainte `UNIQUE`, et non sur une convention d'appelant. `sync_queue` ne portait aucune
 * identité cliente — c'est très exactement pourquoi l'idempotence a été reportée de 3.10
 * jusqu'ici.
 *
 * ⚠️ **Un 409 est donc un SUCCÈS**, pas une erreur : il dit « je l'ai déjà ». Le traiter en
 * échec ferait boucler la file sur une entrée que le serveur a bel et bien acceptée.
 *
 * ## La réconciliation
 *
 * Au retour d'un `create`, le serveur rend son identifiant. Il est écrit **dans
 * l'enregistrement lui-même** (`FeatureRecord.serverId`), et non dans l'entrée de file : la
 * file ne référence que `localId` (contrat), et elle disparaît une fois poussée. Sans cette
 * écriture, l'entité serait re-créée au rapatriement suivant au lieu d'être reconnue.
 *
 * ## Le retry appartient à la FILE, pas au transport
 *
 * ⚠️ Le transport est `fetchBounded` et **non** `FetchHelper`, qui réessaie tout seul. Deux
 * autorités de retry — l'une dans le transport, l'autre dans `attempts`/`failed` — se
 * compteraient l'une l'autre et rendraient le nombre de tentatives inexplicable. C'est la
 * forme même du défaut « deux mécanismes qui ne se rencontrent jamais » que ce sprint ferme
 * ailleurs.
 *
 * @version 1.0.0
 */

import { Log } from "../../../utils/log/index.js";
import { StorageContract } from "../../../kernel/shared/index.js";
import { fetchBounded } from "../../../utils/general/fetch-bounded.js";
import { coreProfileLayerConfig } from "../config-seam.js";
import { isUnsafeKey } from "../../../utils/general/object-path-guard.js";
import type {
    FeatureRecord,
    OutboxEntry,
    QuarantineReason,
} from "../../../contracts/sync.contract.js";

/** Propriété portant l'identité cliente sur le fil. Partagée avec le schéma du backend. */
const CLIENT_ID_PROPERTY = "local_id";

/**
 * Budget de rejeu — nombre TOTAL d'essais avant mise en quarantaine, premier inclus.
 *
 * 🛑 **IL N'EXISTAIT PLUS (B-125).** Un `MAX_REPLAY_ATTEMPTS = 3` vivait dans la file v3, où il
 * était appliqué **à l'écriture** ; il est parti avec le magasin à la tâche 4.11. Mesuré alors :
 * l'outbox portait bien un champ `attempts`, mais ce moteur ne l'incrémentait ni ne le
 * plafonnait — le budget était **déjà absent du chemin v4** avant ce retrait, qui n'a fait que
 * le rendre visible.
 *
 * Conséquence produit sans lui : une entrée qui échoue est rejouée **indéfiniment**, et l'état
 * `quarantined` que le contrat décrit comme « kept, but not replayable as-is » est atteint
 * par `markFailure` ci-dessous depuis la tâche 4.11d — quatre `QuarantineReason` déclarés,
 * quatre producteurs. ⚠️ Ce commentaire disait « n'est atteint par AUCUN chemin — trois
 * motifs déclarés, zéro producteur » jusqu'à la tâche 8.4, dans le fichier même qui les
 * produit. Et la sortie de cette quarantaine existe désormais : `write/quarantine-api.ts`.
 *
 * ⚠️ Il compte les essais TOTAUX, pas les reprises : `3` = un envoi initial + deux rejeux.
 * Même convention que `RetryHandler` du téléchargement, pour qu'un lecteur n'ait pas à se
 * demander laquelle des deux s'applique.
 */
const MAX_REPLAY_ATTEMPTS = 3;

/**
 * Statuts qui disent « pas MAINTENANT », par opposition à « pas comme ça » (B-199).
 *
 * 🛑 **CETTE DISTINCTION N'EXISTAIT PAS, ET SON ABSENCE CONDAMNAIT DES SAISIES.** Jusqu'au
 * 09/08/2026 `pushOne` avait une seule branche pour tout ce qui n'est ni 409 ni 404 : un 503 de
 * maintenance et un 403 définitif en sortaient sous le même `rejectedByServer`. Ce motif étant
 * exclu de `REQUEUEABLE` (`quarantine-api.ts`), une panne serveur transitoire épuisait le budget
 * puis rendait l'entrée NON REJOUABLE — sa seule sortie devenait `discardQuarantined`,
 * c'est-à-dire la destruction de la saisie. Le drain se déclenche au retour du réseau **et sur
 * le bouton « Réessayer »**, et `attempts` est persistant : trois clics pendant une maintenance
 * suffisaient.
 *
 * ⚠️ **Chaque membre est ici pour une raison qui lui est propre, pas parce qu'il est en 5xx** :
 * 500/502/503/504 nomment un serveur ou un intermédiaire hors d'état de répondre, 408 un délai
 * dépassé, 429 un débit refusé. Tous redeviennent vrais sans que l'entrée change. **501 n'y est
 * PAS** : il ne dit pas « pas maintenant » mais « je ne connais pas ce verbe », ce qui appelle
 * une quarantaine immédiate — voir {@link PushFailure}.
 */
const TRANSIENT_SERVER_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

/** Le serveur déclare ne pas implémenter le verbe — HTTP 501. */
const NOT_IMPLEMENTED_STATUS = 501;

/**
 * Pourquoi un envoi a échoué.
 *
 * ⚠️ **Seules les valeurs que ce module PRODUIT sont déclarées.** Une première rédaction en
 * portait trois de plus — `layerUnknown`, `noWriteTarget`, `recordMissing` — qu'aucun chemin
 * ne rendait jamais : ces cas sont traités dans la boucle, avant l'envoi. Un membre
 * d'union que rien ne produit est indiscernable d'une faute de frappe, exactement ce que le
 * contrat reproche à un dialecte pré-déclaré.
 */
type PushFailure =
    /**
     * Le serveur a refusé pour une raison que le rejeu ne corrigera pas.
     *
     * ⚠️ **RESSERRÉ à B-199.** Ce membre a nommé TOUT échec non-409/non-404 jusqu'au
     * 09/08/2026, pannes serveur comprises. Il ne couvre plus que les refus définitifs — les
     * 4xx autres que 404 et 501 : requête malformée, droit manquant, verbe non autorisé,
     * entité non traitable.
     */
    | "rejectedByServer"
    /**
     * Le serveur n'était pas en état de répondre, et le sera peut-être au prochain drain.
     *
     * Il ne porte PAS son propre `QuarantineReason` : au plafond il tombe sur
     * `retryBudgetExhausted`, qui dit exactement ce qui s'est passé — le budget a été dépensé
     * sans que le serveur réponde jamais de façon actionnable — et qui est **rejouable**.
     */
    | "serverUnavailable"
    /**
     * Le serveur ne connaît pas le verbe — HTTP 501.
     *
     * 🛑 **Quarantaine IMMÉDIATE, et pourtant REJOUABLE.** Les deux moitiés sont dérivées du
     * sens : rejouer trois fois un verbe non implémenté ne fait qu'attendre trois fois (même
     * argument que `deletedOnServer`), mais la mise à jour du serveur EST la levée de cause, et
     * elle n'est pas observable ici — donc confiée à l'opérateur, comme `retryBudgetExhausted`.
     *
     * ⚠️ C'est le miroir du carve-out du dialecte `rest` plus bas, qui traite un « non
     * implémenté » CÔTÉ CLIENT comme rejouable. Les traiter à l'inverse l'un de l'autre était
     * l'asymétrie que B-199 a mesurée.
     */
    | "notImplementedByServer"
    /** Le réseau n'a pas répondu. */
    | "networkError"
    /**
     * Le serveur ne connaît plus l'entité — 404 sur un `update` ou un `delete`.
     *
     * ⚠️ **Le vocabulaire d'opération DÉCIDE**, et c'est ce qui rend ce membre productible :
     * un 404 sur un `create` dit que l'endpoint est faux, pas que l'entité a disparu. Les
     * confondre ferait mettre en quarantaine une couche mal configurée sous un motif qui
     * accuse le serveur.
     */
    | "deletedOnServer";

/** Ce qu'un drain complet a fait. */
interface PushReport {
    readonly attempted: number;
    readonly pushed: number;
    readonly failed: number;
    /** Entrées déjà connues du serveur — un 409 sur l'identité cliente. */
    readonly alreadyPresent: number;
    /** Conflits DÉTECTÉS puis tranchés par `lastWriteWins` (tâche 4.6). */
    readonly conflicts: number;
    readonly refused: "engineUnavailable" | null;
}

/** Cible d'écriture résolue depuis la déclaration de couche. */
interface WriteTarget {
    readonly endpoint: string;
    readonly dialect: "rest" | "collection";
    readonly geometryProperty: string;
    readonly properties: readonly string[] | null;
    /** Colonne servant de marqueur de fraîcheur — le filtre du conflit (4.6). */
    readonly versionProperty: string;
}

/**
 * Les deux modules de base que le drain lit et écrit, réduits à ce qu'il en utilise.
 *
 * ⚠️ `list()` remplace `listByState()` ici depuis B-126 : c'est le seul des deux qui rende
 * l'ordre d'insertion GLOBAL. `listByState` le tient à l'intérieur d'un état — ce qui suffit
 * à qui lit un seul état, et jamais à qui en rejoue deux.
 */
interface OutboxModule {
    /** Toutes les entrées, dans l'ordre d'insertion (clé `seq`, `autoIncrement`). */
    list(): Promise<OutboxEntry[]>;
    updateState(
        id: string,
        state: string,
        patch?: { attempts?: number; quarantine?: QuarantineReason; quarantineStatus?: number }
    ): Promise<void>;
    remove(id: string): Promise<void>;
}
interface FeaturesModule {
    get(layerId: string, localId: string): Promise<FeatureRecord | null>;
    put(record: FeatureRecord): Promise<void>;
    remove(layerId: string, localId: string): Promise<void>;
}

/** Le seam de stockage, réduit à ce que ce module lit et écrit. */
interface PushStore {
    _ensureModule?: (name: string) => unknown;
}

/**
 * Marque un échec : incrémente le budget, et met de côté quand il est épuisé.
 *
 * 🛑 **UN SEUL POINT DE SORTIE POUR L'ÉCHEC (B-125).** Les quatre chemins d'échec du drain
 * faisaient chacun `updateState(id, "failed")` — quatre écritures, aucune ne touchant
 * `attempts`. Un compteur que personne n'incrémente ne plafonne rien, et un plafond réparti
 * sur quatre sites se serait désynchronisé au premier cinquième chemin.
 *
 * @param outbox - Le module de file.
 * @param entry - L'entrée qui vient d'échouer ; son `attempts` est la base du décompte.
 * @param reason - Motif de quarantaine IMMÉDIATE, quand le rejeu ne peut rien y changer.
 *   Sans lui, l'entrée reste `failed` jusqu'à épuisement du budget.
 * @param lastFailure - Ce qui a fait échouer le dernier envoi, quand il y en a eu un. Il
 *   DÉCIDE du motif au plafond : un refus serveur épuisé n'est pas un réseau muet épuisé.
 * @param httpStatus - Statut du refus, quand il y en a eu un. B-200 : il VOYAGE AVEC L'ENTRÉE
 *   au lieu de rester dans un `Log.warn` que personne n'ouvre sur le terrain.
 * @returns `true` si l'entrée est passée en quarantaine.
 */
async function markFailure(
    outbox: OutboxModule,
    entry: OutboxEntry,
    reason?: QuarantineReason,
    lastFailure?: PushFailure,
    httpStatus?: number
): Promise<boolean> {
    const attempts = (entry.attempts ?? 0) + 1;
    // ⚠️ Une quarantaine IMMÉDIATE ne consomme pas le budget, elle le court-circuite : rejouer
    // trois fois une couche qui a perdu son bloc `write` ne fait qu'attendre trois fois.
    //
    // 🛑 AU PLAFOND, LE MOTIF SUIT LE DERNIER ÉCHEC. Un serveur qui refuse trois fois a REFUSÉ ;
    // un réseau muet trois fois n'a rien dit. Écrire `retryBudgetExhausted` dans les deux cas
    // aurait produit un motif juste et un motif faux sous le même nom — et laissé
    // `rejectedByServer` déclaré sans producteur, ce que le contrat qualifie lui-même
    // d'« indiscernable d'une faute de frappe ».
    //
    // ⚠️ **CE RAISONNEMENT ÉTAIT JUSTE, ET SA PRÉMISSE ÉTAIT FAUSSE (B-199).** « Un serveur qui
    // refuse trois fois a REFUSÉ » suppose que `rejectedByServer` nomme un refus — or il
    // nommait, jusqu'au 09/08/2026, TOUT échec non-409/non-404, pannes 5xx comprises. La
    // ligne ci-dessous n'a pas changé : c'est `pushOne` qui ne produit plus `rejectedByServer`
    // que pour un vrai refus, et un `serverUnavailable` tombe donc du bon côté sans qu'aucun
    // motif nouveau soit nécessaire ici.
    const exhausted: QuarantineReason =
        lastFailure === "rejectedByServer" ? "rejectedByServer" : "retryBudgetExhausted";
    const quarantine = reason ?? (attempts >= MAX_REPLAY_ATTEMPTS ? exhausted : null);
    if (quarantine) {
        Log.warn(
            `[Offline.Push] ${entry.id} — QUARANTAINE (${quarantine}) après ${attempts} essai(s). ` +
                "L'entrée reste en base : le contrat interdit de la détruire."
        );
        // B-200 — `quarantineStatus` n'est écrit QUE s'il existe : une quarantaine qui ne vient
        // pas d'une réponse serveur (`layerNoLongerWritable`, réseau muet au plafond) ne doit
        // pas se voir attribuer un statut fabriqué. Un champ absent dit « pas de réponse » ;
        // un `0` dirait « le serveur a répondu 0 », ce qui est faux et indiscernable.
        await outbox.updateState(entry.id, "quarantined", {
            attempts,
            quarantine,
            ...(httpStatus !== undefined ? { quarantineStatus: httpStatus } : {}),
        });
        return true;
    }
    await outbox.updateState(entry.id, "failed", { attempts });
    return false;
}

/**
 * Résout la cible d'écriture d'une couche.
 *
 * ⚠️ **Par COUCHE, et jamais par plugin** (point 7 du contrat). Deux mécanismes se
 * disputaient ce rôle sans jamais se rencontrer : un bloc par couche, lu en quatre endroits
 * mais posé par **zéro couche sur 48** avant 4.H, et une URL de base au niveau du plugin qui
 * ignore la couche entièrement. Sur un backend où chaque couche est une collection distincte
 * — Odoo, PostgREST —, seule la première forme peut être juste.
 *
 * @param layerId - Couche visée.
 * @returns La cible, ou `null` quand la couche n'en déclare aucune d'utilisable.
 */
function resolveWriteTarget(layerId: string): WriteTarget | null {
    const config = coreProfileLayerConfig(layerId);
    if (!config) return null;
    const write = config.write as
        | {
              enabled?: boolean;
              endpoint?: string;
              dialect?: string;
              geometryProperty?: string;
              properties?: string[];
          }
        | undefined;
    if (write?.enabled !== true || !write.endpoint) return null;
    return {
        endpoint: write.endpoint,
        dialect: write.dialect === "rest" ? "rest" : "collection",
        geometryProperty: write.geometryProperty ?? "geom",
        properties: Array.isArray(write.properties) ? write.properties : null,
        // La même colonne que celle dont 4.1 relève le `VersionMarker` : les deux moitiés du
        // cycle doivent nommer la MÊME chose, sinon le conflit se compare à côté.
        versionProperty:
            (config.offline as { source?: { versionProperty?: string } } | undefined)?.source
                ?.versionProperty ?? "updated_at",
    };
}

/**
 * Construit le corps envoyé au serveur pour le dialecte `collection` — un objet PLAT.
 *
 * La liste blanche `properties` est une liste blanche : ce qui n'y figure pas ne part jamais.
 * Deux clés s'y ajoutent parce qu'elles relèvent du protocole et non du formulaire : la
 * géométrie, et l'identité cliente qui rend le rejeu idempotent.
 *
 * @param record - L'enregistrement local à envoyer.
 * @param target - La cible résolue.
 * @returns Le corps prêt à sérialiser.
 */
function buildCollectionBody(record: FeatureRecord, target: WriteTarget): Record<string, unknown> {
    const feature = (record.feature ?? {}) as { geometry?: unknown; properties?: unknown };
    const properties = (
        feature.properties && typeof feature.properties === "object" ? feature.properties : {}
    ) as Record<string, unknown>;

    // ⚠️ TOUTE clé écrite ici vient de données : la liste blanche de la couche, ou les
    // propriétés de l'entité quand la couche n'en déclare pas. Un nom `__proto__` ou
    // `constructor` polluerait le prototype du corps sérialisé — la garde canonique du dépôt
    // est ce qui rend le cas inatteignable plutôt qu'improbable.
    const body: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const allowed = target.properties ?? Object.keys(properties);
    for (const name of allowed) {
        if (isUnsafeKey(name)) continue;
        const value = properties[name];
        if (value !== undefined) body[name] = value;
    }
    if (!isUnsafeKey(target.geometryProperty)) body[target.geometryProperty] = feature.geometry;
    body[CLIENT_ID_PROPERTY] = record.localId;
    return body;
}

/**
 * Requête HTTP correspondant à une opération.
 *
 * 🛑 **Le dialecte `collection` seulement, et le refus de l'autre est EXPLICITE.** Le contrat
 * déclare deux dialectes parce que le code des plugins en implémente deux ; côté core, aucune
 * couche du dépôt ne déclare `rest` — `sites_rosario`, seule à porter un bloc `write`, est en
 * `collection`. Construire ici un corps plat et l'envoyer à un endpoint REST « au cas où »
 * enverrait la mauvaise forme **en silence**, ce qui est la classe de défaut que ce sprint
 * ferme. Le drain refuse donc `rest` par son nom, et cette ligne est ce qui dira au prochain
 * lecteur qu'il reste un dialecte à écrire.
 */
function buildRequest(
    entry: OutboxEntry,
    record: FeatureRecord,
    target: WriteTarget,
    conditional = true
): { url: string; init: RequestInit } {
    const identified = `${target.endpoint}?id=eq.${encodeURIComponent(String(record.serverId))}`;
    // 🛑 TÂCHE 4.6 — LE MARQUEUR DE BASE DEVIENT UN FILTRE, ET C'EST CE QUI REND LE CONFLIT
    // DÉTECTABLE. Mesuré contre le vrai PostgREST : un `PATCH` filtré sur un `updated_at`
    // PÉRIMÉ rend **200 avec un tableau VIDE** — zéro ligne touchée, donc quelqu'un d'autre a
    // écrit entre-temps. Avec un marqueur à jour, 1 ligne. C'est la seule chose qui manquait :
    // le contrat dit que le gain n'est pas l'issue mais que le conflit devienne OBSERVABLE.
    //
    // ⚠️ `encodeURIComponent` n'est pas décoratif : le `+` du fuseau horaire d'un timestamp
    // ISO doit être encodé, sinon PostgREST le lit comme une espace et rend
    // `400 invalid input syntax for type timestamp`. Mesuré aussi.
    const guarded =
        conditional && entry.baseVersion
            ? `${identified}&${target.versionProperty}=eq.${encodeURIComponent(entry.baseVersion.value)}`
            : identified;
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        // Le serveur renvoie la ligne créée : c'est de là que vient le `serverId`, et le
        // demander explicitement évite un second aller-retour pour l'apprendre.
        Prefer: "return=representation",
    };

    if (entry.kind === "delete") {
        return { url: guarded, init: { method: "DELETE", headers } };
    }
    const body = JSON.stringify(buildCollectionBody(record, target));
    if (entry.kind === "create") {
        return { url: target.endpoint, init: { method: "POST", headers, body } };
    }
    return { url: guarded, init: { method: "PATCH", headers, body } };
}

/**
 * Pousse une entrée, et rend l'identité serveur quand le serveur en fournit une.
 *
 * @param entry - L'entrée de file.
 * @param record - L'entité qu'elle nomme.
 * @param target - La cible d'écriture de la couche.
 * @param conditional - Filtrer sur le marqueur de base, ce qui rend le conflit détectable
 *   (4.6). Mis à `false` pour le SECOND envoi, celui qui tranche par `lastWriteWins` : le
 *   conflit a déjà été observé et journalisé, refiltrer le ferait échouer une seconde fois.
 * @returns L'issue, le `serverId` à réconcilier, et si un conflit a été détecté.
 */
async function pushOne(
    entry: OutboxEntry,
    record: FeatureRecord,
    target: WriteTarget,
    conditional = true
): Promise<{
    ok: boolean;
    serverId?: string;
    alreadyPresent?: boolean;
    conflicted?: boolean;
    failure?: PushFailure;
    /** Statut du refus, quand le serveur a répondu — B-200, il voyage avec l'entrée. */
    httpStatus?: number;
}> {
    const { url, init } = buildRequest(entry, record, target, conditional);
    let response: Response;
    try {
        response = await fetchBounded(url, init);
    } catch (error) {
        Log.warn(`[Offline.Push] ${entry.id} — réseau muet :`, String(error));
        return { ok: false, failure: "networkError" };
    }

    // 🛑 409 = « je l'ai déjà ». La contrainte UNIQUE sur l'identité cliente est ce qui rend
    // le rejeu sûr ; la traiter en échec ferait boucler la file sur un succès.
    if (response.status === 409) return { ok: true, alreadyPresent: true };

    if (!response.ok) {
        // 404 sur une entité que le serveur devrait connaître : elle a été supprimée là-bas
        // pendant qu'on l'éditait ici. Le rejeu ne la ressuscitera pas.
        if (response.status === 404 && entry.kind !== "create") {
            Log.warn(`[Offline.Push] ${entry.id} — l'entité n'existe plus côté serveur (404).`);
            return { ok: false, failure: "deletedOnServer", httpStatus: response.status };
        }
        // 🛑 LA CLASSE DU STATUT DÉCIDE DU SORT DE LA SAISIE (B-199). Ces trois branches
        // étaient une seule ligne rendant `rejectedByServer` — donc une entrée non rejouable —
        // pour un 503 comme pour un 403. Le détail du raisonnement est sur
        // `TRANSIENT_SERVER_STATUSES` et sur les membres de {@link PushFailure}.
        if (response.status === NOT_IMPLEMENTED_STATUS) {
            Log.warn(
                `[Offline.Push] ${entry.id} — le serveur ne connaît pas ce verbe (501) ; quarantaine immédiate.`
            );
            return { ok: false, failure: "notImplementedByServer", httpStatus: response.status };
        }
        if (TRANSIENT_SERVER_STATUSES.has(response.status)) {
            Log.warn(
                `[Offline.Push] ${entry.id} — serveur indisponible (${response.status}) ; l'entrée reste rejouable.`
            );
            return { ok: false, failure: "serverUnavailable", httpStatus: response.status };
        }
        Log.warn(`[Offline.Push] ${entry.id} — refusé (${response.status}).`);
        return { ok: false, failure: "rejectedByServer", httpStatus: response.status };
    }

    const payload = (await response.json().catch(() => null)) as
        { id?: unknown } | Array<{ id?: unknown }> | null;
    // 🛑 ZÉRO LIGNE TOUCHÉE SUR UNE MISE À JOUR CONDITIONNELLE = CONFLIT (tâche 4.6).
    // L'entité existe (l'identité serveur est connue) mais son marqueur de fraîcheur ne
    // correspond plus : quelqu'un a écrit entre la lecture et ce push. Mesuré : PostgREST rend
    // `200 []`. C'est la seule forme sous laquelle ce serveur sait le dire.
    if (conditional && entry.baseVersion && entry.kind === "update") {
        const affected = Array.isArray(payload) ? payload.length : payload ? 1 : 0;
        if (affected === 0) return { ok: false, conflicted: true };
    }

    const row = Array.isArray(payload) ? payload[0] : payload;
    const serverId = row?.id;
    return serverId != null ? { ok: true, serverId: String(serverId) } : { ok: true };
}

/**
 * Draine l'`outbox` : pousse chaque opération en attente et réconcilie les identités.
 *
 * Ne jette pas — chaque entrée a son issue, et une entrée qui échoue reste en file avec son
 * compteur incrémenté. `failed` n'est **pas terminal** (contrat) : c'est la garantie qu'une
 * saisie de terrain revient au prochain drain plutôt que de disparaître.
 *
 * @returns Le décompte réel du drain.
 * @example
 * const report = await GeoLeaf?.Storage?.pushOutbox?.();
 * console.info(`${report?.pushed} poussées, ${report?.failed} à retenter`);
 */
export async function pushOutbox(): Promise<PushReport> {
    const nothing = { attempted: 0, pushed: 0, failed: 0, alreadyPresent: 0, conflicts: 0 };
    const db = StorageContract.DB as PushStore | null;
    const outbox = db?._ensureModule?.("Outbox") as OutboxModule | null | undefined;
    const features = db?._ensureModule?.("Features") as FeaturesModule | null | undefined;
    if (!outbox?.list || !features?.put) return { ...nothing, refused: "engineUnavailable" };

    // 🛑 LECTURE UNIQUE, PUIS FILTRE — ET C'EST L'ORDRE QUI L'EXIGE (B-126, tâche 4.11b).
    //
    // Ce bloc faisait `[...listByState("pending"), ...listByState("failed")]`. C'est
    // **exactement la concaténation que B-03 avait fait corriger** sur la file v3 : deux
    // lectures d'index, mises bout à bout, donc toutes les `pending` avant toutes les
    // `failed` quel que soit leur rang de saisie.
    //
    // ⚠️ **La coalescence ne rend PAS le cas impossible**, contrairement à ce qu'on pourrait
    // croire : `local-edit.ts` absorbe bien une nouvelle édition dans une entrée `failed`
    // existante (`COALESCIBLE = {pending, failed}`), mais **pas pendant la fenêtre
    // `inFlight`**, qui n'est délibérément pas fusionnable. Une édition faite pendant qu'un
    // push est en vol empile donc une seconde entrée, et si le push échoue l'entité porte une
    // `failed` de rang N et une `pending` de rang N+1 — que la concaténation inversait.
    //
    // `list()` rend « Every entry, in INSERTION order » : le magasin est `autoIncrement`, donc
    // `getAll()` sort dans l'ordre des clés, c'est-à-dire des `seq`. L'ordre est tenu **par
    // construction** et non par un tri — `db/outbox.ts` le dit dans ses propres termes : « A
    // sort would be a second ordering authority, i.e. the defect's own shape. »
    //
    // ✅ Et ce drain était le SEUL à concaténer : `poi-restore.ts:135`, l'autre lecteur de
    // l'outbox, appelle `list()` depuis toujours. La restauration au boot tenait donc l'ordre
    // que le rejeu perdait — deux lectures du même magasin, deux ordres.
    const REPLAYABLE = new Set(["pending", "failed"]);
    const pending = (await outbox.list()).filter((entry) => REPLAYABLE.has(entry.state));

    let pushed = 0;
    let failed = 0;
    let alreadyPresent = 0;
    let conflicts = 0;

    for (const entry of pending) {
        const target = resolveWriteTarget(entry.layerId);
        if (!target) {
            Log.warn(
                `[Offline.Push] ${entry.id} — aucune cible d'écriture pour "${entry.layerId}".`
            );
            // Quarantaine IMMÉDIATE : une couche qui a perdu sa cible d'écriture ne la
            // retrouvera pas en rejouant. C'est exactement ce que `layerNoLongerWritable`
            // nomme, et c'est son PREMIER producteur (B-125).
            await markFailure(outbox, entry, "layerNoLongerWritable");
            failed += 1;
            continue;
        }
        // Refus NOMMÉ plutôt qu'un corps plat envoyé à un endpoint REST : voir `buildRequest`.
        if (target.dialect === "rest") {
            Log.warn(
                `[Offline.Push] ${entry.id} — dialecte "rest" non implémenté côté core ; l'entrée reste en file.`
            );
            // ⚠️ PAS de quarantaine ici, et c'est délibéré : le dialecte `rest` est un trou
            // du CORE, pas un défaut de l'entrée. Une version qui l'implémente le rejouera.
            // L'entrée consomme donc son budget comme les autres — un trou qui dure lui
            // deviendra visible en quarantaine plutôt que de la faire boucler sans fin.
            await markFailure(outbox, entry);
            failed += 1;
            continue;
        }

        const record = await features.get(entry.layerId, entry.localId);
        if (!record) {
            Log.warn(`[Offline.Push] ${entry.id} — l'entité nommée a disparu du magasin.`);
            await markFailure(outbox, entry);
            failed += 1;
            continue;
        }

        // `inFlight` AVANT l'appel, et c'est ce qui protège la coalescence de 4.4 : une
        // édition concurrente ne fusionnera pas dans une entrée déjà partie sur le fil.
        await outbox.updateState(entry.id, "inFlight");
        let result = await pushOne(entry, record, target);

        // ── `lastWriteWins`, DÉCLARÉ plutôt que subi (tâche 4.6) ────────────────────────
        //
        // L'issue est la même qu'avant : la version locale l'emporte. Ce qui change est que le
        // conflit a été DÉTECTÉ et JOURNALISÉ avant d'être tranché — jusqu'ici il était
        // indiscernable d'une écriture normale, et « la stratégie » se réduisait à un en-tête
        // `X-Force-Update` qu'AUCUN serveur du dépôt ne lit.
        //
        // Le motif est le terrain, et il est dans le contrat : un opérateur est l'autorité sur
        // ce qu'il vient d'observer, et une boîte de dialogue levée hors réseau, seul sur site,
        // se clique au hasard.
        if (result.conflicted) {
            conflicts += 1;
            Log.warn(
                `[Offline.Push] ${entry.id} — CONFLIT : "${entry.layerId}"/${entry.localId} a changé côté serveur depuis la saisie. Politique lastWriteWins : la version locale écrase.`
            );
            result = await pushOne(entry, record, target, false);
        }

        if (!result.ok) {
            // Le chemin pour lequel le budget existe : réseau muet ou refus serveur. Les deux
            // PEUVENT être transitoires, donc on rejoue — jusqu'au plafond, pas au-delà. Le
            // motif écrit au plafond distingue les deux.
            //
            // ⚠️ `deletedOnServer` est l'exception : il ne consomme pas le budget. Rejouer une
            // entité que le serveur a supprimée ne peut ni la recréer ni la modifier — c'est
            // une décision de produit, pas un incident de transport, et elle doit remonter à
            // l'opérateur maintenant plutôt que dans trois drains.
            //
            // ✅ `notImplementedByServer` REJOINT L'EXCEPTION à B-199, sur le même argument :
            // rejouer un verbe que le serveur déclare ne pas connaître ne fait qu'attendre
            // trois fois. La différence est en aval — celui-ci est REJOUABLE une fois le
            // serveur mis à jour, là où `deletedOnServer` ne l'est jamais.
            const immediate: QuarantineReason | undefined =
                result.failure === "deletedOnServer" || result.failure === "notImplementedByServer"
                    ? result.failure
                    : undefined;
            await markFailure(outbox, entry, immediate, result.failure, result.httpStatus);
            failed += 1;
            continue;
        }

        if (entry.kind === "delete") {
            // L'entité a fini son cycle : la file la lâche, et le magasin aussi.
            await features.remove(entry.layerId, entry.localId);
        } else {
            await features.put({
                ...record,
                serverId: result.serverId ?? record.serverId,
                syncState: "synced",
            });
        }
        await outbox.remove(entry.id);
        pushed += 1;
        if (result.alreadyPresent) alreadyPresent += 1;
    }

    Log.info(
        `[Offline.Push] ${pushed} poussée(s), ${failed} à retenter, ${conflicts} conflit(s) tranché(s).`
    );
    return { attempted: pending.length, pushed, failed, alreadyPresent, conflicts, refused: null };
}
