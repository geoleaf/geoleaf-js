/*!
 * @geoleaf-plugins/editor — Config resolver
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { EditorConfig, EditorTool } from "./types.js";
import type { LayerEditionPermissions } from "@geoleaf/core/contracts/sync.contract.js";
import { coreConfigGet } from "@geoleaf/host-runtime";
import { getGeoLeaf } from "@geoleaf/host-runtime";
// B-161 — sous-chemin publié du core : l'alias `geometry`/`geometryType` a UNE résolution.
import { layerGeometry } from "@geoleaf/core/kernel/config/layer-geometry.js";

const ALL_TOOLS: EditorTool[] = [
    "point",
    "line",
    "polyline",
    "polygon",
    "select",
    "undo",
    "redo",
    "delete",
];

const VALID_PERSIST_MODES = ["online", "offline", "auto"] as const;
const VALID_CONFLICT_RES = ["client-wins", "server-wins", "prompt"] as const;

/** Default values for `editorConfig` (mirrors CDC §1.7). */
export const EDITOR_CONFIG_DEFAULTS: EditorConfig = {
    enabled: true,
    showButton: true,
    // B-12 (25/07/2026) — `"top-left"` jusqu'ici, et c'était le seul ancrage utilisable
    // sur les quatre, donc la collision était inévitable : le pill s'y superposait à la
    // toolbar du core (`.gl-map-toolbar-wrapper`, même colonne, z-index 1000 contre 980),
    // rendant les boutons d'outils visibles mais inatteignables au clic.
    // ⚠️ Portée : seulement quand le menu s'ouvre SANS ancre — l'API publique
    // `GeoLeaf.Editor.toggleMenu()`. Le clic sur le bouton de la toolbar passe une ancre
    // et `positionEditorMenuNear` écartait déjà le menu (vérifié).
    // Les quatre ancrages fonctionnent désormais ; le défaut passe à droite.
    menuPosition: "top-right",
    // 5.1-e — visible par défaut, comme l'était le bouton d'export d'`addpoi` ; mais ce
    // drapeau-ci est DÉCLARÉ, donc réellement modifiable (R19).
    showExport: true,
    // 5.1-f — remplace `ui.showAddPoi`. Visible par défaut, comme l'était le bouton
    // d'`addpoi` ; mais ce drapeau-ci vit sous `modules.editor`, DÉCLARÉ dans le schéma,
    // là où `ui.showAddPoi` faisait décider au core l'affichage d'un bouton que seul un
    // plugin pouvait servir.
    showAddPoi: true,
    // 5.1-f — absorbé de `modules.addpoi.defaultPosition`, que le CORE lisait
    // (`init-features.ts:220`) : une clé de config de plugin résolue par le kernel.
    poiAddDefaultPosition: "placement-mode",
    enabledTools: [...ALL_TOOLS],
    snapPx: 12,
    // 5.1-a — absorbed from `addpoi`, where the equivalent knob was UNREACHABLE: it was read
    // per-layer as `layer.snapTolerance`, a key that `profiles/schemas/layer-config.schema.json`
    // does not declare while being `additionalProperties: false`. Writing it failed
    // `validate:profiles`, so all 4 editable point layers ran on the hard-coded 50 m fallback.
    // Moving it to the plugin config makes it settable for the first time.
    poiSnapMeters: 50,
    vertexHandleSize: 8,
    midpointHandleSize: 5,
    minVerticesLineString: 2,
    minVerticesPolygon: 3,
    api: {
        baseUrl: "",
        authHeader: null,
        timeoutMs: 8000,
        // Property key under which the geometry is sent in the "collection" dialect (ANO-079).
        geometryProperty: "geom",
    },
    persistence: {
        mode: "auto",
        conflictResolution: "prompt",
        // Backend wire dialect — "rest" envelope by default (ANO-080).
        dialect: "rest",
    },
    undoStackSize: 100,
    modal: {
        desktopBreakpointPx: 768,
        maxWidthPx: 640,
    },
    confirmDelete: true,
    confirmCancelOnDirty: true,
    defaultLayer: null,
    eventNamespace: "editor",
};

/** Validates and resets persistence enum values to their defaults. */
function validatePersistence(
    p: NonNullable<EditorConfig["persistence"]>
): NonNullable<EditorConfig["persistence"]> {
    const out = { ...p };
    if (out.mode !== undefined && !(VALID_PERSIST_MODES as readonly string[]).includes(out.mode)) {
        console.warn(`[editor] Unknown persistence.mode "${out.mode}", reset to "auto".`);
        out.mode = "auto";
    }
    if (
        out.conflictResolution !== undefined &&
        !(VALID_CONFLICT_RES as readonly string[]).includes(out.conflictResolution)
    ) {
        console.warn(
            `[editor] Unknown persistence.conflictResolution "${out.conflictResolution}", reset to "prompt".`
        );
        out.conflictResolution = "prompt";
    }
    return out;
}

/** Clamps a number to [min, max]; falls back to `fallback` if the value is NaN. */
function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
    const n = Number(value);
    return Math.min(max, Math.max(min, isNaN(n) ? fallback : n));
}

/**
 * Clamps the flat numeric bounds in place. `clamp` already coerces via `Number()`
 * and falls back on NaN, so `snapPx` / `minVertices*` / `undoStackSize` route
 * through it directly (their `min` absorbs the legacy `0`-fallback behaviour).
 */
function _clampScalarBounds(out: EditorConfig): void {
    if (out.snapPx !== undefined) out.snapPx = clamp(out.snapPx, 0, Infinity, 0);
    if (out.poiSnapMeters !== undefined)
        out.poiSnapMeters = clamp(out.poiSnapMeters, 0, Infinity, 50);
    if (out.vertexHandleSize !== undefined)
        out.vertexHandleSize = clamp(out.vertexHandleSize, 4, 24, 8);
    if (out.midpointHandleSize !== undefined)
        out.midpointHandleSize = clamp(out.midpointHandleSize, 3, 20, 5);
    if (out.minVerticesLineString !== undefined)
        out.minVerticesLineString = clamp(out.minVerticesLineString, 2, Infinity, 2);
    if (out.minVerticesPolygon !== undefined)
        out.minVerticesPolygon = clamp(out.minVerticesPolygon, 3, Infinity, 3);
    if (out.undoStackSize !== undefined)
        out.undoStackSize = clamp(out.undoStackSize, 1, Infinity, 1);
}

/** Clamps the nested `api` / `modal` numeric bounds in place. */
function _clampNestedBounds(out: EditorConfig): void {
    if (out.api?.timeoutMs !== undefined) {
        out.api = { ...out.api, timeoutMs: clamp(out.api.timeoutMs, 100, Infinity, 8000) };
    }
    if (out.modal?.desktopBreakpointPx !== undefined) {
        out.modal = {
            ...out.modal,
            desktopBreakpointPx: clamp(out.modal.desktopBreakpointPx, 1, Infinity, 768),
        };
    }
    if (out.modal?.maxWidthPx !== undefined) {
        out.modal = { ...out.modal, maxWidthPx: clamp(out.modal.maxWidthPx, 1, Infinity, 640) };
    }
}

/** Drops unknown tools; resets to the full set when filtering empties the list. */
function _filterEnabledTools(out: EditorConfig): void {
    if (out.enabledTools === undefined) return;
    const filtered = out.enabledTools.filter((t) =>
        ALL_TOOLS.includes(t as EditorTool)
    ) as EditorTool[];
    out.enabledTools = filtered.length > 0 ? filtered : [...ALL_TOOLS];
}

/** Clamps numeric bounds and resets unknown enum values to their defaults. */
function validateEditorConfig(cfg: EditorConfig): EditorConfig {
    const out: EditorConfig = { ...cfg };
    _clampScalarBounds(out);
    _clampNestedBounds(out);
    _filterEnabledTools(out);
    if (out.persistence) out.persistence = validatePersistence(out.persistence);
    return out;
}

/** Resolves the `showButton (editorConfig) ↔ ui.showEditor (UIConfig)` alias precedence. */
function _resolveShowButton(raw: EditorConfig): boolean | undefined {
    const uiShowEditor = (
        getGeoLeaf()?.Config?.get?.("ui", {}) as { showEditor?: boolean } | undefined
    )?.showEditor;
    return raw.showButton ?? uiShowEditor ?? EDITOR_CONFIG_DEFAULTS.showButton;
}

/**
 * Returns the resolved `editorConfig`: defaults merged with the integrator's profile values.
 * Handles the `showButton ↔ ui.showEditor` alias and clamps all numeric bounds.
 * @public
 */
export function getEditorConfig(): EditorConfig {
    // INV-CONFIG: read from `modules.editor` (Plugin Contract v1).
    //
    // ⚠️ Cette ligne a promis, jusqu'au 29/07/2026, que « le miroir S0 du core garde la clé
    // synchronisée avec la racine héritée `editorConfig` pendant la fenêtre de dépréciation, de
    // sorte que les profils non migrés résolvent encore » (B-72). **La fenêtre est fermée et le
    // miroir a disparu** — mesuré : `grep -rn "editorConfig" packages/core/src/` rend 0. Un profil
    // resté sur `editorConfig` est donc ignoré **en silence**, exactement comme ceux restés sur
    // `printConfig` ou `measureConfig`.
    //
    // Ce qui rendait cet énoncé plus coûteux que ses jumeaux : il ne vivait pas dans un vieux CDC
    // mais **dans le code**, à l'endroit même qui gouverne la lecture — et `src/` est dans
    // `files[]`, donc dans l'archive npm. Un intégrateur qui lit la source du paquet installé y
    // trouvait une promesse fausse.
    const raw = coreConfigGet<EditorConfig>("modules.editor", {} as EditorConfig);

    // Insertion conditionnelle : cette cle est posee APRES `...EDITOR_CONFIG_DEFAULTS`, donc
    // un `undefined` explicite y ECRASERAIT le defaut du paquet.
    const showButton = _resolveShowButton(raw);
    const merged: EditorConfig = {
        ...EDITOR_CONFIG_DEFAULTS,
        ...raw,
        ...(showButton !== undefined && { showButton }),
        api: {
            ...EDITOR_CONFIG_DEFAULTS.api,
            ...raw.api,
        },
        persistence: {
            ...EDITOR_CONFIG_DEFAULTS.persistence,
            ...raw.persistence,
        },
        modal: {
            ...EDITOR_CONFIG_DEFAULTS.modal,
            ...raw.modal,
        },
    };

    return validateEditorConfig(merged);
}

// ---------------------------------------------------------------------------
// Editable layers — single reader of the profile's `edition` block
// ---------------------------------------------------------------------------

/** A profile layer, narrowed to the keys the editor reads. */
interface ProfileLayer {
    id: string;
    label?: string;
    /**
     * Per-operation permissions — the core's `LayerEditionPermissions`, imported rather
     * than redeclared. Redeclaring the shape here is what let the old pair drift into two
     * readers of opposite polarity.
     */
    edition?: LayerEditionPermissions;
    /** Profile vocabulary — `"point" | "polyline" | "polygon"` (ANO-007). */
    geometryType?: string;
    /**
     * Le MÊME champ que `geometryType`, sous son autre orthographe — le schéma pose les deux
     * comme alias et interdit de migrer (ANO-007). ⚠️ Absente de ce type jusqu'à B-161, donc
     * `_acceptsGeometry` ne pouvait pas la lire et le typecheck n'avait rien à en dire : c'est
     * une des raisons pour lesquelles le défaut a vécu. Lire par `layerGeometry`, jamais à la main.
     */
    geometry?: string;
    /** GeoJSON vocabulary — `"Point" | "LineString" | "Polygon"`. */
    editableGeometryTypes?: string[];
}

/** Profile `geometryType` → GeoJSON geometry name. The two vocabularies differ (ANO-007). */
const _GEOJSON_FOR_PROFILE_TYPE: Record<string, string> = {
    point: "Point",
    polyline: "LineString",
    line: "LineString",
    polygon: "Polygon",
};

/**
 * Decides whether a layer accepts the given GeoJSON geometry.
 *
 * 🛑 **C'EST ICI QUE 5.2 TRANCHE LE CRITÈRE, et il le RÉCONCILIE au lieu d'en jeter un.**
 * Le dépôt en portait deux : celui-ci (`editableGeometryTypes[]`, pluriel, vocabulaire
 * GeoJSON) et celui d'`addpoi`, recopié dans `drawing/poi-snap.ts` (`geometryType`,
 * singulier, vocabulaire de profil). Ils divergeaient — une couche déclarant l'un et pas
 * l'autre était éditable par un chemin et pas par l'autre.
 *
 * ⚠️ **Garder le seul `editableGeometryTypes` ÉLARGISSAIT en silence** : son repli
 * (`?.includes(g) !== false` — absent vaut `undefined !== false`, donc `true`) accepte TOUTE
 * géométrie. Une couche polygone sans la clé serait devenue candidate au placement d'un
 * point, et donc au garde-fou de doublon. Mesuré : deux tests de `poi-snap` l'ont attrapé.
 *
 * L'ordre est donc : la clé plurielle si elle existe, **sinon** le type déclaré de la couche,
 * **sinon seulement** on accepte. Une couche sans aucun signal reste ouverte — c'est le
 * comportement d'avant, et le restreindre serait un changement de contrat.
 */
function _acceptsGeometry(layer: ProfileLayer, geometryType: string): boolean {
    if (Array.isArray(layer.editableGeometryTypes)) {
        return layer.editableGeometryTypes.includes(geometryType);
    }
    // 🛑 B-161 — CETTE LIGNE NE LISAIT QUE `geometryType`, ET C'EST LE MODE D'ÉCHEC QUE LE
    // TSDoc CI-DESSUS DÉCRIT COMME DANGEREUX. Le schéma pose `geometryType` comme « alias of
    // `geometry` » (ANO-007), mais **18 des 24** configs du dépôt ne déclarent que `geometry`
    // et **aucune** ne déclare `geometryType` seul. Pour toutes celles-là, `own` était falsy
    // et la fonction retombait sur `return true` — « accepte TOUTE géométrie ». Une couche
    // polygone qui déclare sa géométrie devenait donc candidate au placement d'un POINT,
    // exactement ce que l'ordre décrit plus haut existe pour empêcher.
    const declared = layerGeometry(layer);
    const own = declared && _GEOJSON_FOR_PROFILE_TYPE[declared];
    return own ? own === geometryType : true;
}

/**
 * Layers the profile marks editable, in profile order.
 *
 * Single source for the two consumers that used to resolve this independently
 * (PLUGINS S4): `selection/layer-picker` derived a `Set` of ids through a raw
 * `globalThis.GeoLeaf.Config` cast, and `modal/layer-dropdown` returned the layer
 * objects through `getGeoLeaf()`. They had also drifted — only the picker carried
 * the `typeof id === "string"` guard, so a profile layer with no `id` reached the
 * dropdown and rendered a selectable `value="undefined"` option. The guard is kept
 * here for both.
 *
 * @param geometryType - When set, also drops layers whose `editableGeometryTypes`
 * excludes it. Omit it to get every editable layer regardless of geometry — this
 * is what the click-picker wants, and narrowing it would silently make layers
 * unclickable.
 */
export function getEditableLayers(geometryType?: string): ProfileLayer[] {
    const profile = getGeoLeaf()?.Config?.getActiveProfile?.() as
        | { layers?: ProfileLayer[] }
        | undefined;
    return (profile?.layers ?? []).filter(
        (l) =>
            // 🛑 `create` OU `update`, JAMAIS `delete` — c'est tout l'objet de la décision V1.
            // Cette ligne lisait `enableEdition || enableEditionFull`, une rustine posée en
            // 5.2 pour ne pas laisser le second drapeau sans lecteur. Elle avait un effet que
            // son nom ne laissait pas deviner : le droit de SUPPRIMER faisait entrer une
            // couche dans le sélecteur d'édition. Une couche qui n'accorde que `delete` n'a
            // rien à faire ici — on ne propose pas de créer sur une couche où l'on n'a que le
            // droit d'effacer.
            (l.edition?.create === true || l.edition?.update === true) &&
            typeof l.id === "string" &&
            (!geometryType || _acceptsGeometry(l, geometryType))
    );
}
