/*!
 * GeoLeaf Core (offline capability) — Bounded layer pull
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Bounded pull — the FIRST writer of the `features` store (tâche 4.1).
 *
 * Le store existe depuis 3.4 et a reçu son lecteur en 4.3
 * (`IndexedDB.getLayerFeatureCollection`). Il n'avait aucun écrivain : `DBFeatures.put`
 * comptait zéro appelant en `src/`. Ce module le lui donne.
 *
 * Il applique `PullGranularity = "bboxCapped"` du contrat de synchronisation — emprise plus
 * plafond dur — et **n'écrit aucun code de transport** : `fetchOgcApiFeatures` porte déjà la
 * pagination par lien `next`, le `bbox`, `maxFeatures` et l'`AbortSignal`.
 *
 * Trois propriétés que ce module existe pour tenir :
 *
 * 1. **Le plafond est DUR.** `ogc-api-loader` coupe *après* avoir accumulé une page entière
 *    et ne tronque jamais : mesuré, `maxFeatures: 15` avec `limit: 10` rend **20** entités.
 *    Un « rapatriement borné » qui rend plus que sa borne n'est pas borné — la troncature
 *    est ici, et `capped` la rend observable.
 * 2. **Une saisie locale n'est jamais écrasée.** La décision vit dans
 *    `db/features.ts#putManyPreservingLocal`, dans **une** transaction ; ici on ne fait que
 *    rapporter son décompte.
 * 3. **Le rapatriement ne confère JAMAIS l'éditabilité** (invariant S6). Les enregistrements
 *    sortent en `syncState: "synced"`, et ce module ne touche pas à l'`outbox`.
 *
 * ⚠️ **N'importe pas `../db/indexeddb.js`.** `packages/core/vitest.config.ts` aliase
 * `^\.\./db/indexeddb\.(js|ts)$` vers le mock maison, qui n'a ni `_ensureModule` ni le store
 * `features` : le test serait vert contre une fiction. L'écriture passe par
 * `StorageContract.DB`, comme le fait déjà la lecture de 4.3 dans `loader/single-layer.ts`.
 *
 * @version 1.0.0
 */
"use strict";

import { Log } from "../../../utils/log/index.js";
import { StorageContract } from "../../../kernel/shared/index.js";
import { coreProfileLayerConfig } from "../config-seam.js";
import { writePullState } from "../report/pull-state.js";
import type { FeatureRecord } from "../../../contracts/sync.contract.js";

/** Nom de propriété portant l'horodatage de fraîcheur, quand la couche n'en déclare pas. */
const DEFAULT_VERSION_PROPERTY = "updated_at";

/** Pourquoi un rapatriement n'a pas eu lieu. Jamais `null` sans écriture tentée. */
type PullRefusal =
    /** Aucune couche de ce nom dans le profil actif. */
    | "layerUnknown"
    /** La couche ne déclare pas `offline.source` — elle n'est pas rapatriable. */
    | "noSource"
    /** Le moteur de stockage n'est pas câblé (`modules.offline` désactivé, ou pas encore prêt). */
    | "engineUnavailable"
    /** La source a répondu par une erreur, ou n'a pas répondu. */
    | "sourceUnreachable";

/** Ce qu'un appelant peut borner au moment de l'appel. */
interface LayerPullOptions {
    /** Emprise `[ouest, sud, est, nord]`. Une zone de terrain n'est pas une constante de profil. */
    readonly bbox?: [number, number, number, number];
    /** Abandon coopératif. Le lot déjà reçu est écrit, et `aborted` le dit. */
    readonly signal?: AbortSignal;
}

/** Ce que le rapatriement a réellement fait — chaque champ est assertable. */
interface LayerPullReport {
    readonly layerId: string;
    /** Entités rendues par la source, **avant** le plafond. */
    readonly fetched: number;
    /** Entités insérées ou rafraîchies. */
    readonly written: number;
    /** Entités laissées intactes parce qu'elles portent une saisie non synchronisée. */
    readonly preserved: number;
    /** Entités sans identité serveur exploitable — écartées, jamais en silence. */
    readonly skipped: number;
    /** Vrai quand le plafond a tronqué le lot. */
    readonly capped: boolean;
    /** Vrai quand le signal de l'appelant a été levé : le lot est PARTIEL. */
    readonly aborted: boolean;
    /** `null` quand le rapatriement a eu lieu. */
    readonly refused: PullRefusal | null;
}

/** Forme minimale du bloc `offline` d'une configuration de couche. */
interface OfflineDeclaration {
    readonly maxFeatures?: number;
    readonly source?: {
        readonly url?: string;
        readonly collectionId?: string;
        readonly versionProperty?: string;
    };
}

/**
 * Les seuls membres du seam de stockage que ce module utilise.
 *
 * `putLayerFeatures` écrit le lot ; les deux accesseurs de préférence portent le marqueur de
 * rapatriement de la tâche 4.8. ⚠️ Le refus `engineUnavailable` ne teste que `putLayerFeatures` :
 * un moteur qui écrirait les entités sans pouvoir écrire son marqueur doit rapatrier quand même
 * — perdre le rapport est ennuyeux, perdre le rapatriement ne l'est pas du tout.
 */
interface FeatureWriter {
    putLayerFeatures?: (
        records: readonly FeatureRecord[]
    ) => Promise<{ written: number; preserved: number } | null>;
    getPreference?: (key: string, defaultValue?: unknown) => Promise<unknown>;
    setPreference?: (key: string, value: unknown) => Promise<unknown>;
}

/**
 * Convertit une entité OGC en enregistrement du store.
 *
 * Trois règles, chacune mesurée sur le backend de preuve (`docker/backend/README.md`) :
 *
 * - **`serverId`** vient de `feature.id`, avec `properties.id` en second — pygeoapi sert les
 *   deux, et un serveur qui n'en sert qu'un reste lisible.
 * - **`localId`** reprend `properties.local_id` quand le serveur en porte un, sinon il est
 *   dérivé du `serverId`. Les lignes semées ont `local_id: null` ; celles que 4.5 poussera
 *   porteront l'identité cliente, et la reprendre est ce qui fera qu'un re-rapatriement
 *   retrouve le MÊME enregistrement au lieu d'en créer un second.
 * - **`updatedAt` reste local.** Le contrat le documente comme « Local modification time » :
 *   y écrire l'horodatage serveur ferait signifier deux choses à l'index selon l'écrivain.
 *   Le marqueur serveur va dans `version`, et nulle part ailleurs — c'est lui que 4.6
 *   comparera.
 *
 * @param layerId - Couche de destination.
 * @param feature - L'entité GeoJSON telle que la source l'a rendue.
 * @param versionProperty - Propriété portant l'horodatage de fraîcheur.
 * @param now - Horodatage local appliqué à tout le lot.
 * @returns L'enregistrement, ou `null` si l'entité n'a aucune identité serveur.
 */
function toFeatureRecord(
    layerId: string,
    feature: unknown,
    versionProperty: string,
    now: number
): FeatureRecord | null {
    if (!feature || typeof feature !== "object") return null;
    const shape = feature as { id?: unknown; properties?: unknown };
    const properties = (
        shape.properties && typeof shape.properties === "object" ? shape.properties : {}
    ) as Record<string, unknown>;

    const rawServerId = shape.id ?? properties.id;
    if (rawServerId === undefined || rawServerId === null || rawServerId === "") return null;
    const serverId = String(rawServerId);

    const declaredLocalId = properties.local_id;
    const localId =
        typeof declaredLocalId === "string" && declaredLocalId.length > 0
            ? declaredLocalId
            : `srv:${serverId}`;

    const marker = properties[versionProperty];
    return {
        layerId,
        localId,
        serverId,
        syncState: "synced",
        updatedAt: now,
        version:
            marker === undefined || marker === null
                ? null
                : { kind: "timestamp", value: String(marker) },
        feature,
    };
}

/** Ce qu'il faut réunir avant de solliciter la source — ou le motif de ne pas le faire. */
interface PullPlan {
    readonly refused: PullRefusal | null;
    readonly ogcConfig: { url: string; collectionId: string; maxFeatures?: number };
    readonly maxFeatures: number | undefined;
    readonly versionProperty: string;
    readonly db: FeatureWriter;
}

/**
 * Réunit la déclaration de la couche et le seam d'écriture, ou nomme ce qui manque.
 *
 * Extrait de {@link pullLayer} pour une raison mécanique — la fonction dépassait le plafond de
 * complexité —, mais la découpe est aussi la bonne : tout ce qui peut refuser AVANT la première
 * requête réseau tient ici, et rien d'autre.
 *
 * @param layerId - Identifiant de la couche à rapatrier.
 * @returns Le plan, ou un plan dont `refused` est renseigné (les autres champs sont alors inertes).
 */
function resolvePullPlan(layerId: string): PullPlan {
    const inert = {
        ogcConfig: { url: "", collectionId: layerId },
        maxFeatures: undefined,
        versionProperty: DEFAULT_VERSION_PROPERTY,
        db: {} as FeatureWriter,
    };

    const config = coreProfileLayerConfig(layerId);
    if (!config) return { ...inert, refused: "layerUnknown" };

    const offline = config.offline as OfflineDeclaration | undefined;
    const source = offline?.source;
    if (!source?.url) return { ...inert, refused: "noSource" };

    const db = StorageContract.DB as FeatureWriter | null;
    if (!db?.putLayerFeatures) return { ...inert, refused: "engineUnavailable" };

    const maxFeatures = typeof offline?.maxFeatures === "number" ? offline.maxFeatures : undefined;

    // `collectionId` défaut = l'identifiant de couche : c'est la correspondance réelle sur le
    // backend de preuve, et elle évite de redire deux fois le même nom dans le profil. Une
    // `url` qui pointe déjà sur `/items` reste servie telle quelle par `_buildItemsUrl`.
    // Construit sans clés à `undefined` : `exactOptionalPropertyTypes` distingue « absent »
    // de « présent et indéfini ».
    return {
        refused: null,
        ogcConfig: {
            url: source.url,
            collectionId: source.collectionId ?? layerId,
            ...(maxFeatures !== undefined ? { maxFeatures } : {}),
        },
        maxFeatures,
        versionProperty: source.versionProperty ?? DEFAULT_VERSION_PROPERTY,
        db,
    };
}

/**
 * Rapatrie une couche déclarée, bornée par emprise et par plafond, dans le store `features`.
 *
 * Ne jette pas : toute issue est un rapport. Une source injoignable, une couche inconnue ou
 * un moteur absent rendent un `refused` nommé — un rapatriement qui échoue en rendant zéro
 * sans motif est indiscernable d'une couche réellement vide, et c'est cette confusion que le
 * sprint ferme.
 *
 * @param layerId - Identifiant de la couche à rapatrier.
 * @param options - Emprise et signal d'abandon.
 * @returns Le rapport de ce qui a été fait.
 * @example
 * const report = await GeoLeaf?.Storage?.pullLayer?.("sites_rosario");
 * if (report?.refused) console.warn("pas de rapatriement :", report.refused);
 * else console.info(`${report?.written} entités écrites`);
 */
export async function pullLayer(
    layerId: string,
    options: LayerPullOptions = {}
): Promise<LayerPullReport> {
    const nothing = {
        layerId,
        fetched: 0,
        written: 0,
        preserved: 0,
        skipped: 0,
        capped: false,
        aborted: false,
    };

    const plan = resolvePullPlan(layerId);
    if (plan.refused) return { ...nothing, refused: plan.refused };

    const { ogcConfig, maxFeatures, versionProperty, db } = plan;

    let collection;
    try {
        // 🛑 IMPORT DYNAMIQUE, et ce n'est pas de la coquetterie. Le baril
        // `kernel/geojson/index.js` est la seule route que R.8 ouvre vers le transport OGC,
        // mais il tire tout le sous-système geojson : en statique, il entrait dans le graphe
        // d'import de `offline-engine-entry.ts` et faisait dépasser les 10 s de timeout au
        // test de câblage sous la suite parallèle (24 workers). Le transport n'est nécessaire
        // qu'au moment d'un rapatriement — le charger là est aussi ce qui allège le chunk.
        const { fetchOgcApiFeatures } = await import("../../../kernel/geojson/index.js");
        collection = await fetchOgcApiFeatures(ogcConfig, options.signal, options.bbox);
    } catch (error) {
        Log.warn(
            `[Offline.Pull] "${layerId}" — source injoignable :`,
            error instanceof Error ? error.message : String(error)
        );
        // 🛑 L'ÉCHEC SE PERSISTE, et c'est la moitié utile du marqueur (tâche 4.8). Sans lui,
        // une couche dont la source est tombée retomberait sur `declaredNeverPulled` — le même
        // statut qu'une couche qu'on n'a jamais tenté de rapatrier. `pullFailed` dit qu'on a
        // essayé et que la source a répondu non : c'est actionnable, l'autre ne l'est pas.
        await writePullState(db, layerId, { at: Date.now(), outcome: "failed", written: 0 });
        return { ...nothing, refused: "sourceUnreachable" };
    }

    const fetched = collection?.features ?? [];
    // Le plafond DUR. `ogc-api-loader` s'arrête après une page entière et ne tronque pas :
    // sans cette coupe, `maxFeatures: 15` écrit 20 enregistrements et sort vert.
    const capped = maxFeatures !== undefined && fetched.length > maxFeatures;
    const bounded = capped ? fetched.slice(0, maxFeatures) : fetched;

    const now = Date.now();
    const records: FeatureRecord[] = [];
    for (const feature of bounded) {
        const record = toFeatureRecord(layerId, feature, versionProperty, now);
        if (record) records.push(record);
    }

    const tally = (await db.putLayerFeatures?.(records)) ?? { written: 0, preserved: 0 };

    // ⚠️ `outcome: "ok"` même quand `written` vaut 0 — c'est exactement le cas que 4.8 existe
    // pour rendre distinguable. Une source qui répond « aucune entité dans cette emprise » a
    // bien été jointe ; la confondre avec « jamais rapatriée » est la confusion que le contrat
    // nomme « le cas qui n'a aucun observable jusqu'à la coupure ».
    await writePullState(db, layerId, {
        at: now,
        outcome: "ok",
        written: tally.written,
    });

    // ⚠️ Relu sur le signal, pas sur le retour : `fetchOgcApiFeatures` rend une collection
    // partielle par le MÊME chemin qu'un succès, sans marqueur. Un lot partiel est écrit —
    // en terrain, des entités valent mieux que rien — mais il ne doit pas se faire passer
    // pour complet.
    return {
        layerId,
        fetched: fetched.length,
        written: tally.written,
        preserved: tally.preserved,
        skipped: bounded.length - records.length,
        capped,
        aborted: options.signal?.aborted === true,
        refused: null,
    };
}
