/*!
 * GeoLeaf Core (offline capability) — Persisted pull outcomes
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Le marqueur de rapatriement — ce qui rend `declaredNeverPulled` observable (tâche 4.8).
 *
 * 🛑 **Il existe parce que le décompte d'entités NE SUFFIT PAS, et c'est le fond de 4.8.**
 * Une couche déclarée hors-ligne dont le rapatriement a rendu zéro entité est, dans le store,
 * strictement indiscernable d'une couche jamais rapatriée : zéro dans les deux cas. Or ce sont
 * deux situations opposées — la première est saine, la seconde est celle qui n'a « aucun
 * observable jusqu'à la coupure » que le contrat nomme. Sans trace écrite du fait qu'un
 * rapatriement A EU LIEU, le rapport devrait deviner, et un rapport qui devine est pire que
 * pas de rapport.
 *
 * ⚠️ **`updatedAt` du `FeatureRecord` ne peut pas servir de repli** : 4.1 l'a délibérément
 * gardé LOCAL (« Local modification time »), donc une saisie hors réseau le fait avancer sans
 * qu'aucun rapatriement n'ait eu lieu. Il daterait l'édition, pas le rapatriement.
 *
 * Persisté dans le store `preferences`, sous UNE clé portant toutes les couches — même patron
 * que `offline.dataOrigins` (`data-origins.ts`, tâche 4.H). Aucun store neuf, aucune migration
 * de schéma IndexedDB.
 *
 * @version 1.0.0
 */
"use strict";

import { Log } from "../../../utils/log/index.js";
import { isUnsafeKey } from "../../../utils/general/object-path-guard.js";

/** Clé unique du store `preferences` portant l'état de rapatriement de toutes les couches. */
export const PULL_STATE_KEY = "offline.pullState";

/** Ce qu'un rapatriement laisse derrière lui, qu'il ait abouti ou non. */
export interface LayerPullState {
    /** Horodatage local de la tentative, en millisecondes. */
    readonly at: number;
    /** `ok` quand la source a répondu — même en rendant zéro entité. */
    readonly outcome: "ok" | "failed";
    /** Entités écrites lors de cette tentative. Toujours 0 quand `outcome` est `failed`. */
    readonly written: number;
}

/** L'état de toutes les couches, tel qu'il est persisté. */
export type PullStateMap = Readonly<Record<string, LayerPullState>>;

/** Le seul membre du seam de stockage que ce module utilise. */
interface PreferenceStore {
    getPreference?: (key: string, defaultValue?: unknown) => Promise<unknown>;
    setPreference?: (key: string, value: unknown) => Promise<unknown>;
}

/**
 * Vrai quand la valeur relue a la forme d'un {@link LayerPullState}.
 *
 * ⚠️ La validation n'est pas de la cérémonie : le store `preferences` est écrit par plusieurs
 * versions du code au fil des déploiements, et une entrée d'une forme antérieure lue sans
 * contrôle donnerait un statut FAUX plutôt qu'absent. Une entrée non reconnue est traitée
 * comme absente — donc `declaredNeverPulled`, qui est le repli sûr : il alerte.
 */
function isLayerPullState(value: unknown): value is LayerPullState {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.at === "number" &&
        (v.outcome === "ok" || v.outcome === "failed") &&
        typeof v.written === "number"
    );
}

/**
 * Relit l'état de rapatriement de toutes les couches.
 *
 * Ne jette jamais : une persistance indisponible rend un état vide, et le rapport dira
 * `declaredNeverPulled` — ce qui est vrai du point de vue de l'observateur.
 *
 * @param db - La façade de stockage (`GeoLeaf.Storage.DB`).
 * @returns L'état par couche ; `{}` quand rien n'a jamais été écrit ou que la lecture échoue.
 * @example
 * const state = await readPullState(GeoLeaf?.Storage?.DB);
 * console.info(state["sites_rosario"]?.outcome);
 */
export async function readPullState(db: PreferenceStore | null | undefined): Promise<PullStateMap> {
    try {
        const raw = await db?.getPreference?.(PULL_STATE_KEY, null);
        if (!raw || typeof raw !== "object") return {};
        const out: Record<string, LayerPullState> = {};
        for (const [layerId, value] of Object.entries(raw as Record<string, unknown>)) {
            // 🛑 La valeur relue vient d'IndexedDB, donc d'un désérialiseur : `__proto__` en
            // sort comme propriété PROPRE, énumérée par `Object.entries`, et `out[k] = …`
            // l'enverrait sur le setter de prototype. Le magasin n'est pas une source de
            // confiance parce qu'il est local — il est écrit par du code de plusieurs
            // versions, et il survit aux déploiements.
            if (isUnsafeKey(layerId)) continue;
            if (isLayerPullState(value)) out[layerId] = value;
        }
        return out;
    } catch (err) {
        Log.warn("[Offline.PullState] Lecture impossible :", (err as Error).message);
        return {};
    }
}

/**
 * Enregistre l'issue d'un rapatriement pour UNE couche, en préservant celle des autres.
 *
 * ⚠️ **Lecture-modification-écriture, et la clé est unique** : deux rapatriements concurrents
 * sur deux couches pourraient se perdre l'un l'autre. C'est accepté ici, et le motif est
 * mesurable — `pullLayer` est déclenché par un geste utilisateur, un par un, et l'enjeu est un
 * marqueur d'affichage, pas une saisie. La règle du contrat (« une capture ne disparaît
 * jamais ») porte sur `features` et l'`outbox`, qui eux passent par des transactions.
 *
 * Ne jette jamais : un rapatriement réussi ne doit pas être rapporté en échec parce que son
 * marqueur n'a pas pu s'écrire.
 *
 * @param db - La façade de stockage (`GeoLeaf.Storage.DB`).
 * @param layerId - Couche concernée.
 * @param state - L'issue à enregistrer.
 * @returns Résout une fois l'écriture tentée.
 * @example
 * await writePullState(GeoLeaf?.Storage?.DB, "sites_rosario", {
 *     at: Date.now(),
 *     outcome: "ok",
 *     written: 27,
 * });
 */
export async function writePullState(
    db: PreferenceStore | null | undefined,
    layerId: string,
    state: LayerPullState
): Promise<void> {
    try {
        const current = await readPullState(db);
        await db?.setPreference?.(PULL_STATE_KEY, { ...current, [layerId]: state });
        Log.debug(
            `[Offline.PullState] "${layerId}" — ${state.outcome}, ${state.written} écrite(s)`
        );
    } catch (err) {
        Log.warn(
            `[Offline.PullState] "${layerId}" — écriture impossible :`,
            (err as Error).message
        );
    }
}
