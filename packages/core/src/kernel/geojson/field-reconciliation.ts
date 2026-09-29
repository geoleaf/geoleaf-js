/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The load-time field diagnostic — a declared name the data does not carry is SAID.
 *
 * 🛑 **Why this file exists.** A profile names the properties of its data in free text, and a
 * name the data does not carry reads `undefined`: the taxonomy falls back to the category's icon,
 * an attribute row disappears, a style rule never matches, a filter hides every feature. None of
 * them said a word. The shipped schemas cannot help — they judge the SHAPE of a profile, never its
 * data. This module confronts the two, for every layer the loader converts, and says what it
 * finds in ONE line per layer.
 *
 * ## Diagnose, never fail
 *
 * Nothing here throws, blocks or changes what renders — the patron is the capability registry's
 * unknown-key diagnostic. A reader whose rule throws is skipped; an internal error is logged at
 * debug level and the load goes on. The channel is `Log.warn`, which is recorded whatever the log
 * level (`GeoLeaf.Log.getEntries()`, the diagnostic export): the audience is the profile's author,
 * not the end user, who could not fix a profile — hence no toast.
 *
 * ## Once per layer and field
 *
 * A theme switch reloads the same layers, and a style switch re-judges them: the warning speaks
 * once per `(layer, key, field)` for the page's life, and an unmount re-arms it — the store is
 * cleared by the lifecycle teardown, so a remounted application diagnoses afresh.
 *
 * ## What it does not see
 *
 * Only the features the loader converts: vector tiles keep none in memory, a plugin loader
 * (FlatGeobuf) bypasses the loader, and the writes after the first load — an OGC refresh, a
 * realtime tick, `GeoLeaf.Layers.setData` — are not judged. An empty layer proves nothing and is
 * not judged either.
 */

import { getLog } from "../../utils/general/di-accessors.js";
import { registerLifecycleTeardown } from "../shared/lifecycle.js";
import {
    declaredFieldProviders,
    type DeclaredField,
    type DeclaredFieldFeature,
    type DeclaredFieldsContext,
} from "../shared/declared-fields-slot.js";
import { GeoJSONShared } from "./shared.js";
import {
    findMissingFields,
    kernelDeclaredFields,
    sampleFeatures,
    type MissingField,
} from "./declared-fields.js";

/** `(layer, key, field)` triples already reported, this page's life. */
const _reported = new Set<string>();

// An unmount clears the store: a remounted application diagnoses afresh.
registerLifecycleTeardown(() => _reported.clear());

function _reportKey(layerId: string, field: { key: string; field: string }): string {
    return `${layerId}\u0000${field.key}\u0000${field.field}`;
}

function _isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The kernel's own fields, then every embarked reader's — a reader that throws is skipped. */
function _declaredFields(ctx: DeclaredFieldsContext): DeclaredField[] {
    const out = kernelDeclaredFields(ctx);
    for (const provide of declaredFieldProviders()) {
        try {
            out.push(...provide(ctx));
        } catch (err) {
            getLog().debug?.("[GeoLeaf.GeoJSON] declared-fields reader failed:", err);
        }
    }
    return out;
}

function _describe(missing: MissingField): string {
    const hint = missing.suggestion ? ` (did you mean "${missing.suggestion}"?)` : "";
    return `${missing.key} "${missing.field}"${hint}`;
}

function _message(
    layerId: string,
    missing: readonly MissingField[],
    sampled: number,
    total: number
): string {
    const scope =
        sampled < total
            ? `${sampled} features sampled out of ${total}`
            : `${total} loaded feature${total > 1 ? "s" : ""}`;
    return (
        `[GeoLeaf.GeoJSON] Layer "${layerId}": ${missing.length} declared field(s) carried by ` +
        `none of the ${scope} — ${missing.map(_describe).join("; ")}. Their readers fall back to ` +
        `a default without a word (generic icon, empty row, rule never applied, feature filtered ` +
        `out): check each name against the data — names are case-sensitive.`
    );
}

/**
 * Confronts the fields a layer's readers declare with a sample of its features, and warns — once
 * per layer and field — about each one no sampled feature carries.
 *
 * Never throws: a diagnostic that broke the load would be worse than the silence it replaces.
 *
 * @param layerId - The layer's identifier.
 * @param def - The layer's definition.
 * @param style - The style document the layer wears, or `null`.
 * @param features - The layer's features, as converted. Empty: nothing is judged.
 * @example
 * // In the loader, once the features are converted and the style resolved:
 * reconcileLayerFields(layerId, def, preloadedStyleData, features);
 */
export function reconcileLayerFields(
    layerId: string,
    def: unknown,
    style: unknown,
    features: readonly unknown[]
): void {
    try {
        if (!Array.isArray(features) || features.length === 0) return;
        const ctx: DeclaredFieldsContext = {
            layerId,
            def: _isRecord(def) ? def : {},
            style: _isRecord(style) ? style : null,
        };
        const pending = _declaredFields(ctx).filter((d) => !_reported.has(_reportKey(layerId, d)));
        if (pending.length === 0) return;

        const sample = sampleFeatures(features).filter(_isRecord) as DeclaredFieldFeature[];
        const missing = findMissingFields(pending, sample);
        if (missing.length === 0) return;

        for (const m of missing) _reported.add(_reportKey(layerId, m));
        getLog().warn(_message(layerId, missing, sample.length, features.length));
    } catch (err) {
        getLog().debug?.("[GeoLeaf.GeoJSON] field reconciliation skipped:", err);
    }
}

/**
 * Confronts a style the layer now wears with the features it already holds — the style switch's
 * side of {@link reconcileLayerFields}. Only what was not already reported can speak.
 *
 * @param layerId - The layer's identifier.
 * @param style - The style document just applied.
 * @example
 * // After a style switch has been applied to the layer:
 * reconcileStyleFields(layerId, styleData);
 */
export function reconcileStyleFields(layerId: string, style: unknown): void {
    try {
        const entry = GeoJSONShared.state.layers.get(layerId);
        if (!entry) return;
        reconcileLayerFields(layerId, entry.config, style, entry.features ?? []);
    } catch (err) {
        getLog().debug?.("[GeoLeaf.GeoJSON] field reconciliation skipped:", err);
    }
}
