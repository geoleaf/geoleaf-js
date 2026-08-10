/*!
 * @geoleaf-plugins/editor — Snap-to-existing-feature guard for point capture
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Duplicate guard for point capture: reports the already-existing feature a tap lands on,
 * so the caller can offer to edit it instead of creating a second one.
 *
 * Absorbed from `addpoi/src/poi-placement.ts` (`_findNearbyPoi`) at task 5.1-a.
 *
 * ⚠️ DO NOT CONFUSE THIS WITH `drawing/snap.ts`. Both carry the word "snap" and they are
 * different features — the roadmap's R6 turned on exactly this distinction:
 *
 *   - `snap.ts` configures Terra Draw's snapping. It is a DRAWING COMFORT: radius in
 *     PIXELS (`pointerDistance`), aligns a vertex onto an existing geometry, and it is
 *     wired on the polygon mode ONLY (`modes.ts:120`). The point mode gets none.
 *   - this file is a FIELD-CAPTURE GUARD: radius in METRES, restricted to editable point
 *     layers, and it returns the neighbour's IDENTITY. Terra Draw has no equivalent.
 *
 * The distinction matters on a field device: two surveyors standing at the same lamppost
 * must not create it twice, and a pixel radius means a different ground distance at every
 * zoom level.
 */
import { getGeoLeaf, Log } from "@geoleaf/host-runtime";
import { haversineDistance } from "./geo-compute.js";
import { getEditableLayers } from "../config.js";

/** An existing feature close enough to the tapped position to be a probable duplicate. */
export interface SnappedFeature {
    /** Coordinates of the existing feature — the caller should use these, not the tap. */
    latlng: { lat: number; lng: number };
    /** Ground distance between the tap and the feature, in metres. */
    distanceMeters: number;
    /** Layer the feature belongs to. */
    layerId: string;
    /** Feature identity, when the source carries one. */
    id?: string;
    /** Human-readable label, read from `title` then `name`. */
    title?: string;
}

/** Shape of a profile layer, as far as this guard needs to read it. */
interface SnapCandidateLayer {
    id?: string;
    geometryType?: string;
}

/**
 * Lists the layers this guard is allowed to snap onto: point geometry AND edition enabled.
 *
 * ⚠️ Both conditions are load-bearing. Without the geometry filter the guard would compare a
 * tap against polygon centroids; without the edition filter it would offer to edit a
 * read-only layer.
 *
 * @returns the eligible layers, or an empty array when no profile is active.
 */
function _snapCandidateLayers(): SnapCandidateLayer[] {
    // 5.2 — LECTEUR UNIQUE. Ce filtre reproduisait mot pour mot le critère d'`addpoi`
    // (`geometryType === "point"` + `enableEditionFull || enableEdition`) pendant que
    // `config.ts` filtrait sur `editableGeometryTypes[]` : deux réponses possibles à « quelles
    // couches sont éditables », dans le même paquet. ⚠️ Retirer `addpoi` ne tranchait RIEN —
    // l'éditeur portait déjà les deux. Mesuré sur les 48 configs : les deux critères rendent
    // le MÊME ensemble de 4 couches ponctuelles, l'alignement ne change donc aucun
    // comportement.
    //
    // ✅ 5.9 — la rustine qui vivait ici est RETIRÉE. L'alignement de 5.2 avait laissé
    // `enableEditionFull` sans lecteur, et `getEditableLayers` l'avait donc relu en OU avec
    // `enableEdition` — ce qui le maintenait vivant sans lui rendre son sens, et faisait même
    // du droit de SUPPRIMER un élargisseur du sélecteur. La décision V1 a été exécutée : le
    // critère lit `edition.create || edition.update`, jamais `edition.delete`.
    return getEditableLayers("Point").filter((l) => !!l.id) as SnapCandidateLayer[];
}

/**
 * Finds the nearest already-existing feature within `toleranceMeters` of a tapped position.
 *
 * Scans every feature of every editable point layer — since S9 D4 unified captured POIs onto
 * their host layer, static and session-created features live together and both count as
 * duplicates.
 *
 * @param tap             - Tapped coordinates.
 * @param toleranceMeters - Snap radius in metres. Values `<= 0` disable the guard.
 * @returns the nearest feature within tolerance, or `null` when there is none.
 *
 * @example
 * ```ts
 * const near = findNearbyFeature({ lat: -21.11, lng: 55.53 }, 50);
 * if (near) console.log(`Existing feature ${near.id} at ${near.distanceMeters} m`);
 * ```
 */
export function findNearbyFeature(
    tap: { lat: number; lng: number },
    toleranceMeters: number
): SnappedFeature | null {
    if (!(toleranceMeters > 0)) return null;

    const layerData = getGeoLeaf()?.Layers;
    if (!layerData?.getFeatures) return null;

    let nearest: SnappedFeature | null = null;

    for (const layer of _snapCandidateLayers()) {
        const layerId = layer.id as string;
        let features: unknown[];
        try {
            features = layerData.getFeatures(layerId) ?? [];
        } catch (e) {
            // A layer declared in the profile but never loaded throws rather than
            // returning []. One unloaded layer must not blind the guard on the others.
            Log?.debug?.("[editor/poi-snap] Layer unreadable, skipped:", layerId, e);
            continue;
        }

        for (const raw of features) {
            const candidate = _asCandidate(raw, layerId, tap);
            if (!candidate) continue;
            if (candidate.distanceMeters > toleranceMeters) continue;
            if (nearest && candidate.distanceMeters >= nearest.distanceMeters) continue;
            nearest = candidate;
        }
    }

    return nearest;
}

/**
 * Turns one raw feature into a measured {@link SnappedFeature}, or `null` when it carries no
 * usable point geometry.
 *
 * Split out of {@link findNearbyFeature} to keep it under the repo's complexity ceiling —
 * `eslint` measured 22 against a maximum of 20.
 *
 * @param raw     - Feature as handed back by `GeoLeaf.Layers.getFeatures`.
 * @param layerId - Layer the feature belongs to.
 * @param tap     - Tapped coordinates to measure against.
 * @returns the candidate with its ground distance, or `null` when unusable.
 */
function _asCandidate(
    raw: unknown,
    layerId: string,
    tap: { lat: number; lng: number }
): SnappedFeature | null {
    const feature = raw as {
        id?: string | number;
        geometry?: { type?: string; coordinates?: unknown };
        properties?: Record<string, unknown>;
    };
    if (feature.geometry?.type !== "Point") return null;
    const coords = feature.geometry.coordinates as [number, number] | undefined;
    if (!Array.isArray(coords) || coords.length < 2) return null;

    const [lng, lat] = coords;
    const props = feature.properties ?? {};
    const rawId = feature.id ?? props.id;
    const title = (props.title ?? props.name) as string | undefined;
    return {
        latlng: { lat, lng },
        distanceMeters: haversineDistance([tap.lng, tap.lat], [lng, lat]),
        layerId,
        ...(rawId != null && { id: String(rawId) }),
        ...(title !== undefined && { title }),
    };
}
