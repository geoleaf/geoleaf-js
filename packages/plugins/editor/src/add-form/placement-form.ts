/*!
 * @geoleaf-plugins/editor — "Add a POI" capture flow
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The capture-to-form path behind `GeoLeaf.Editor.AddForm`, and the orchestration that
 * feeds it: pick a position (GPS fix or a map tap), then open the attribute form on a
 * brand-new Point.
 *
 * ## Pourquoi ce fichier existe (tâche 5.1-f)
 *
 * Le seam `poi-addform-seam.ts` du core avait **deux moitiés** — `PlacementMode` et
 * `AddForm`. La tâche 5.1-a a absorbé la première ; celle-ci écrit la seconde, qui
 * n'existait **nulle part** dans `editor` : son formulaire n'était atteignable que par le
 * pont d'événements Terra Draw (`initEventsBridge`), sur une signature incompatible.
 *
 * ⚠️ **Rien n'est transféré d'`addpoi`.** Sa moitié `AddForm` est un sous-système de
 * 2 373 lignes (orchestrateur, contrôleur, gestionnaire d'état, adaptateur de schéma,
 * pont de modale…) qui réimplémente ce que `responsive-modal` + `_getSchemaForLayer` +
 * `submitFeature` font déjà ici. Ce module **mappe**, il ne porte pas de formulaire :
 * c'est le jumeau de `_handleCreate` (`events.ts`), pour une géométrie qui vient d'un
 * point choisi au lieu d'un tracé Terra Draw.
 *
 * ## Trois contraintes mesurées que ce module doit tenir
 *
 * 1. **Le câblage de persistance ne peut pas venir d'`events.ts`.** Son `_wiring` n'est
 *    posé que par `initEventsBridge`, appelé au chargement **paresseux** de Terra Draw.
 *    Poser un POI sans jamais armer d'outil aurait donné une sauvegarde muette. Le
 *    câblage est donc **injecté** par `entry.ts`, qui l'a dès `_initOnMapReady`.
 * 2. **Le rappel de placement est RÉPÉTÉ.** `placement-mode.ts` garde le marqueur après
 *    le tap (`keepMarker: true`) et son `dragend` **rejoue le rappel** pour que le
 *    glisser corrige la position. Le formulaire ne doit donc **pas** se rouvrir : c'est
 *    la géométrie en attente qui se met à jour, lue **à l'instant de la sauvegarde**.
 *    ⚠️ `addpoi` n'avait pas ce cas — non parce qu'il le traitait, mais parce que son
 *    affordance était **morte** : son `deactivate()` supprimait le marqueur juste après
 *    le rappel (`poi-placement.ts:138-141`), alors que le commentaire deux lignes plus
 *    haut annonçait « user can adjust with draggable marker ».
 * 3. **Le marqueur temporaire n'appartient pas au formulaire.** Il survit au tap ; c'est
 *    à la fermeture du formulaire — succès **comme** annulation — de le retirer, sinon il
 *    reste sur la carte sans rien désigner.
 */
import type { Geometry } from "geojson";
import { getGeoLeaf } from "@geoleaf/host-runtime";
import type { ModalOpenOptions } from "../modal/editor-form-modal.js";
import type { EditorWiringContext } from "../events.js";
import { buildSubmitContext } from "../events.js";
import { submitFeature } from "../persistence/submit.js";
import { applyComputedFields } from "../drawing/geo-compute.js";
import { PlacementMode } from "../drawing/placement-mode.js";
import { buildPlacementApi } from "../drawing/placement-api.js";
import { getEditorConfig } from "../config.js";
import { _getLabel, _notify } from "../internal.js";

/** A geographic position, in the shape both the core and the placement mode use. */
export interface LatLng {
    lat: number;
    lng: number;
}

/** Collaborators injected by `entry.ts` — see constraint 1 in the module header. */
export interface AddFormDeps {
    /** Opens the attribute form modal (injected to avoid a circular import). */
    openForm: (options: ModalOpenOptions) => void;
    /**
     * Yields the live persistence wiring, or null when the map is unavailable.
     *
     * ⚠️ A provider, not a value: `entry.ts` rebuilds the wiring from module state that is
     * read at call time, so a snapshot taken at init would freeze a null.
     */
    getWiring: () => EditorWiringContext | null;
}

let _deps: AddFormDeps | null = null;

/**
 * The position the form will save, kept mutable so a marker drag corrects it without
 * reopening the modal (constraint 2). `null` when no capture is in flight.
 */
let _pending: LatLng | null = null;

/**
 * Wires the capture flow. Called from `entry.ts` at map-ready, before any tool is armed.
 *
 * @param deps - See {@link AddFormDeps}.
 */
export function initAddForm(deps: AddFormDeps): void {
    _deps = deps;
}

/** Drops the injected collaborators and any capture in flight. Mirrors `destroy()`. */
export function destroyAddForm(): void {
    _deps = null;
    _pending = null;
}

/** Builds the GeoJSON Point the form will persist, from the pending position. */
function _pendingGeometry(): Geometry {
    const at = _pending;
    return { type: "Point", coordinates: [at?.lng ?? 0, at?.lat ?? 0] };
}

/** Retires the temporary placement marker and ends the capture. */
function _endCapture(): void {
    _pending = null;
    PlacementMode.clearMarker();
}

/**
 * Opens the attribute form for a new Point at `latlng`.
 *
 * Re-entrant by design: while a capture is in flight, a second call only moves the
 * pending position — which is what a marker drag produces (constraint 2).
 *
 * @param latlng - Where the new feature sits.
 *
 * @example
 * ```ts
 * const api = buildAddFormApi();
 * api.openAddForm({ lat: -21.11, lng: 55.53 });
 * ```
 */
export function openAddForm(latlng: LatLng): void {
    const wasCapturing = _pending !== null;
    _pending = { lat: latlng.lat, lng: latlng.lng };
    // A drag correction: the modal is already open on this capture, and reopening it
    // would discard whatever the user has typed.
    if (wasCapturing) return;

    const deps = _deps;
    if (!deps) {
        _notify("error", _getLabel("editor.addform.unavailable"));
        return;
    }

    deps.openForm({
        // Empty title and schema: both are resolved per target layer inside the modal, by
        // the layer dropdown and `getSchemaForLayer`. Same contract as a Terra Draw create.
        title: "",
        schema: [],
        geometryType: "Point",
        initialValues: {},
        computeValues: (schema) => applyComputedFields(schema, _pendingGeometry()),
        onSave: (values, layerId) => {
            const wiring = deps.getWiring();
            if (!wiring) {
                // Loud, never silent: the entry is still in the form, and the user can retry.
                _notify("error", _getLabel("editor.addform.unavailable"));
                return Promise.reject(new Error("[editor/add-form] No persistence wiring"));
            }
            // `_pendingGeometry()` is read HERE, not captured above: a marker dragged while
            // the form was open must save at its corrected position.
            return submitFeature(buildSubmitContext(wiring), {
                feature: { geometry: _pendingGeometry(), properties: values },
                layerId,
                isUpdate: false,
            }).then(_endCapture);
        },
        // Nothing was drawn on the map, so there is no Terra Draw feature to remove and no
        // undo entry to discard — only the temporary marker to retire.
        onCancel: _endCapture,
    });
}

/**
 * Starts the "add a POI" flow: resolve a position, then open the form on it.
 *
 * ⚠️ Descendue du core (`kernel/ui/mobile/mobile-toolbar.ts`, `_handlePoiAdd`) par 5.1-f.
 * Elle y obligeait le kernel à connaître la géolocalisation ET le formulaire d'un plugin ;
 * ici elle est à côté du mode de placement qu'elle arme.
 *
 * @param map - Map instance to arm placement on; `null` lets the plugin resolve its own.
 * @param onSettled - Called when the flow ends without opening the form (cancelled tap),
 *                    so a caller can restore its button state.
 */
export function startPoiCapture(map?: unknown, onSettled?: () => void): void {
    const cfg = getEditorConfig();
    const userPosition = (
        getGeoLeaf()?.Geolocation as { getState?: () => { userPosition?: LatLng | null } }
    )?.getState?.()?.userPosition;

    if (userPosition && cfg.poiAddDefaultPosition === "geolocation") {
        openAddForm(userPosition);
        return;
    }

    buildPlacementApi().activate(map ?? null, (result) => {
        if (result?.latlng) openAddForm(result.latlng);
        else onSettled?.();
    });
}

/** The `GeoLeaf.Editor.AddForm` surface. */
export interface AddFormApi {
    openAddForm(latlng: LatLng): void;
}

/**
 * @returns the add-form slice mounted at `GeoLeaf.Editor.AddForm`.
 *
 * ⚠️ Un objet construit, comme `buildPlacementApi` : `check-facade-purity.cjs` n'accepte
 * dans `public-api.ts` qu'un délégué mince, jamais un littéral imbriqué.
 */
export function buildAddFormApi(): AddFormApi {
    return { openAddForm };
}
