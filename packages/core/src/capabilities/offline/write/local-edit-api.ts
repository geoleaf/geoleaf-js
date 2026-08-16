/*!
 * GeoLeaf Core (offline capability) — Optimistic local edit
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Optimistic write — the entry point every edit plugin goes through (tâche 4.4).
 *
 * Une édition faite hors réseau doit **se voir immédiatement** et **survivre au
 * rechargement**. Les deux moitiés sont indissociables : l'entité part dans le store
 * `features` (que la lecture locale de 4.3 relit au chargement) et l'opération part dans
 * l'`outbox` (que le push de 4.5 rejouera), **dans une seule transaction**.
 *
 * ## Pourquoi ce point est dans le CORE et non dans les plugins d'édition
 *
 * 🛑 **Deux vocabulaires incompatibles écrivaient la même file v3, et un seul passait par le
 * seam.** `addpoi` empile `add_poi` / `update_poi` / `delete_poi` sous une clé `poiData`, via
 * `GeoLeaf.Sync.registerHandler("poi", …)` ; `editor` empile `editor.save` / `editor.update` /
 * `editor.delete` sous une clé `payload`, **sans enregistrer aucun handler**, avec son propre
 * rejeu. Le contrat de synchronisation refuse les deux, et pour la même raison : « The
 * contract is entity-generic because the store is. »
 *
 * L'`outbox` est un store du **core**, et son `kind` est gelé sur `SyncOperationKind`. Un
 * plugin ne peut donc ni l'écrire directement (`no-plugin-in-core`), ni y écrire son propre
 * vocabulaire. Ce module est l'unique écrivain, les plugins deviennent des appelants minces —
 * et la fusion du Sprint 5 n'aura rien à refaire.
 *
 * ## L'invariant S6 se tient ICI, et pas dans la base
 *
 * ⚠️ **Le rapatriement ne confère JAMAIS l'éditabilité.** Une couche peut être rapatriée pour
 * lecture sans être modifiable ; c'est sa déclaration en ligne qui décide, jamais le fait
 * qu'on ait téléchargé ses données. La garde vit dans cette couche-ci parce que c'est la
 * seule qui lit la déclaration : posée dans `db/local-edit.ts`, elle deviendrait une règle de
 * *stockage*, contournable par tout appelant qui parlerait à la base directement.
 *
 * ⚠️ **Le gate est PAR OPÉRATION** depuis le 05/08/2026 (Sprint 5, tâche 5.9 — décision V1),
 * sur `LayerEditionPermissions`. Il remplace la paire `enableEdition` / `enableEditionFull`,
 * dont le second nom ne voulait pas dire « édition complète » : il n'était lu qu'une fois
 * utilement, comme `canDelete()`. **Absent vaut refusé pour chaque clé, et aucune n'en
 * implique une autre.** Ce n'est pas iso-comportemental : l'ancien `enableEdition` gouvernait
 * *tout* `kind` d'un seul drapeau, donc les six couches ont migré en
 * `{create, update, delete}` explicites.
 *
 * ✅ **CE FICHIER N'EST PLUS LE SEUL ENDROIT OÙ LA PERMISSION EST APPLIQUÉE** — corrigé le
 * 07/08/2026 (tâche 8.7, **B-138**). Il l'était, et il ne couvrait que le chemin HORS LIGNE :
 * le chemin en ligne (`editor/src/persistence/rest-adapter.ts`) émettait un `DELETE`
 * inconditionnel, donc une couche déclarant `edition.delete: false` restait supprimable par
 * un utilisateur **connecté**. La permission n'était appliquée que sur le chemin qu'on
 * emprunte quand le réseau est absent.
 *
 * La règle a déménagé dans `kernel/shared/edition-permissions.ts` — **le graphe de boot**,
 * parce qu'elle se lit dans le profil et non dans IndexedDB, et parce qu'`editor` déclare
 * `requires: []` et tourne sans ce moteur en `persistence.mode: "online"`. `applyEdit`
 * l'applique toujours, via `grantsEdition` : c'est la MÊME fonction que celle que le plugin
 * consulte, pas une seconde lecture (compteur C4).
 *
 * ⚠️ **Ce qui reste vrai** : la barre d'outils de l'éditeur gate son outil de suppression sur
 * son propre `enabledTools`, une config de plugin, jamais sur la couche. Le bouton peut donc
 * être offert sur une couche qui refuse — l'écriture, elle, est refusée.
 *
 * @version 1.0.0
 */

import { Log } from "../../../utils/log/index.js";
import { StorageContract, grantsEdition } from "../../../kernel/shared/index.js";
import { coreProfileLayerConfig } from "../config-seam.js";
import type {
    // ⚠️ `LayerEditionPermissions` n'est plus importé ici : le type est interprété par
    // `grantsEdition` (`kernel/shared/edition-permissions.ts`), qui est désormais le seul
    // endroit qui le lit. Le garder aurait été un import mort que `tsc` signale (TS6196).
    SyncOperationKind,
    VersionMarker,
} from "../../../contracts/sync.contract.js";
import type { LocalEditTally } from "../db/local-edit.js";

/** Pourquoi une édition n'a pas été enregistrée. Jamais `null` sans écriture effective. */
type EditRefusal =
    /** Aucune couche de ce nom dans le profil actif. */
    | "layerUnknown"
    /** La couche n'accorde ni `edition.create` ni `edition.update` — invariant S6. */
    | "layerNotEditable"
    /** La couche n'accorde pas `edition.delete`. */
    | "deleteNotPermitted"
    /** Le moteur de stockage n'est pas câblé. */
    | "engineUnavailable"
    /** Une création sans entité, ou une modification sans identité. */
    | "malformedEdit"
    /** Une création sans position — le seul état que le produit rend inatteignable. */
    | "geometryRequired";

/** Une édition locale, telle qu'un plugin d'édition la soumet. */
interface EditInput {
    readonly layerId: string;
    readonly kind: SyncOperationKind;
    /** Requis sauf pour un `create`, où il est frappé ici. */
    readonly localId?: string;
    /** L'entité après édition. Inutile pour un `delete`. */
    readonly feature?: unknown;
    /** Marqueur sur lequel l'édition se fonde ; renvoyé au push pour détecter un conflit. */
    readonly baseVersion?: VersionMarker | null;
}

/** Ce que l'édition a produit. */
interface EditReport {
    readonly layerId: string;
    readonly localId: string;
    readonly kind: SyncOperationKind;
    readonly entryId: string | null;
    readonly queued: boolean;
    readonly coalescedInto: string | null;
    readonly annulled: boolean;
    readonly refused: EditRefusal | null;
}

/** Le seul membre du seam de stockage que ce module utilise. */
interface EditWriter {
    applyLocalEdit?: (input: {
        layerId: string;
        localId: string;
        kind: SyncOperationKind;
        feature?: unknown;
        baseVersion?: VersionMarker | null;
    }) => Promise<LocalEditTally | null>;
}

/**
 * Frappe l'identité cliente d'une entité créée hors réseau.
 *
 * ⚠️ **Elle est frappée par le CLIENT et jamais réutilisée** (contrat, `LocalId`). C'est elle
 * que le push enverra au serveur, et c'est ce qui rend le rejeu idempotent : une seconde
 * tentative porte la même identité, donc le serveur peut la refuser lui-même — ce que le
 * backend de preuve fait par une contrainte `UNIQUE`, et non par une convention d'appelant.
 *
 * Préfixée `loc:` pour ne jamais collisionner avec `srv:<id>`, la forme que le rapatriement
 * de 4.1 dérive d'une identité serveur.
 *
 * @returns Un identifiant local unique.
 */
function mintLocalId(): string {
    const random = globalThis.crypto?.randomUUID?.();
    return `loc:${random ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}

/**
 * Applique une édition localement et la met en file — le point d'entrée des plugins d'édition.
 *
 * Ne jette pas : toute issue est un rapport. Un refus **se nomme**, parce qu'une édition qui
 * disparaît sans motif est indiscernable d'une édition enregistrée, et c'est la perte que le
 * contrat existe pour empêcher.
 *
 * @param input - L'édition soumise par le plugin.
 * @returns Le rapport de ce qui a été fait.
 * @example
 * const report = await GeoLeaf?.Storage?.applyEdit?.({
 *     layerId: "sites_rosario", kind: "update", localId: "loc:abc", feature
 * });
 * if (report?.refused) console.warn("édition refusée :", report.refused);
 */
export async function applyEdit(input: EditInput): Promise<EditReport> {
    const localId = input.localId ?? (input.kind === "create" ? mintLocalId() : "");
    const nothing = {
        layerId: input.layerId,
        localId,
        kind: input.kind,
        entryId: null,
        queued: false,
        coalescedInto: null,
        annulled: false,
    };

    if (!localId) return { ...nothing, refused: "malformedEdit" };

    // 🛑 SEULE LA CRÉATION EXIGE UNE ENTITÉ, ET C'EST DÉLIBÉRÉ.
    //
    // Une modification est une édition PARTIELLE par nature : renommer un point ne renvoie pas
    // sa position. Exiger l'entité complète ici refuserait une saisie déjà faite — et une
    // saisie de terrain refusée est perdue, bruyamment au lieu de silencieusement, ce que la
    // propriété 1 du contrat interdit tout autant. Le magasin conserve ce que l'édition
    // n'apporte pas (`db/local-edit.ts`), donc rien ne se perd sans rien refuser.
    if (input.kind === "create") {
        if (input.feature === undefined) return { ...nothing, refused: "malformedEdit" };
        // ⚠️ Une création SANS POSITION, en revanche, est le seul état que le produit rend
        // inatteignable : le formulaire porte un champ `latlng`, alimenté par le clic de
        // placement. La garde est donc posée sur un état impossible — c'est une garde, pas
        // une perte, et c'est ce qui la distingue d'un refus de mise en file.
        const geometry = (input.feature as { geometry?: unknown } | null)?.geometry;
        if (geometry === undefined || geometry === null) {
            return { ...nothing, refused: "geometryRequired" };
        }
    }

    const config = coreProfileLayerConfig(input.layerId);
    if (!config) return { ...nothing, refused: "layerUnknown" };

    // 🛑 INVARIANT S6. La déclaration de la couche décide, jamais la présence de ses données
    // dans le magasin local. Une couche rapatriée pour lecture reste en lecture.
    //
    // ⚠️ Le gate est PAR OPÉRATION depuis 5.9, et ce n'est pas iso-comportemental : l'ancien
    // `enableEdition` gouvernait *tout* `kind` d'un seul drapeau. Absent vaut REFUSÉ pour
    // chaque clé, et aucune n'en implique une autre — `update` n'accorde pas `delete`. C'est
    // exactement ce que la paire précédente ne savait pas dire, et pourquoi son second nom
    // mentait.
    if (!grantsEdition(config["edition"], input.kind)) {
        return {
            ...nothing,
            refused: input.kind === "delete" ? "deleteNotPermitted" : "layerNotEditable",
        };
    }

    const db = StorageContract.DB as EditWriter | null;
    if (!db?.applyLocalEdit) return { ...nothing, refused: "engineUnavailable" };

    const tally = await db.applyLocalEdit({
        layerId: input.layerId,
        localId,
        kind: input.kind,
        ...(input.feature !== undefined ? { feature: input.feature } : {}),
        ...(input.baseVersion !== undefined ? { baseVersion: input.baseVersion } : {}),
    });

    if (!tally) return { ...nothing, refused: "engineUnavailable" };

    Log.debug(
        `[Offline.Edit] "${input.layerId}"/${localId} ${input.kind} —`,
        tally.annulled ? "annulée" : tally.queued ? "mise en file" : `fusionnée`
    );

    return {
        layerId: input.layerId,
        localId,
        kind: input.kind,
        entryId: tally.entryId,
        queued: tally.queued,
        coalescedInto: tally.coalescedInto,
        annulled: tally.annulled,
        refused: null,
    };
}
