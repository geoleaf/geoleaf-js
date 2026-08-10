/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Taxonomy capability — public API surface.
 *
 * Thin wrappers that delegate to the config reader + pure resolvers — no
 * business logic here. Mounted on `GeoLeaf.Taxonomy` via `geoleaf.taxonomy.ts`.
 *
 * **The `enabled` gate is total.** Every reader below honours it, so an explicit
 * `modules.taxonomy.enabled: false` really does silence the capability: no map
 * icons, no marker discs, no pill badges, no legend icons, no filter categories.
 * It used to gate nothing at all — only a dead painter read it.
 *
 * The gate is opt-out (absent → on), because the key lives in a profile resource
 * that loads after the boot gate reads config.
 *
 * @example
 * // The GeoJSON symbol injector asks for a feature's map icon (tinted id)
 * const { useIcon, symbolId } = GeoLeaf.Taxonomy.resolvePoiIcon(poi);
 *
 * @example
 * // Legend/filter read a taxonomy's categories
 * const cats = GeoLeaf.Taxonomy.getCategories("poi-cat");
 */
"use strict";

import { getTaxonomyConfig } from "./config.js";
import {
    resolveIconVariants as _resolveIconVariants,
    resolveLayerBinding as _resolveLayerBinding,
    resolvePoiIcon as _resolvePoiIcon,
    resolveTitleIcon as _resolveTitleIcon,
    type TaxonomyFeatureLike,
} from "./resolver.js";
import { buildMarkerPaint as _buildMarkerPaint } from "./marker-paint.js";
import { resolveBadgeStyle as _resolveBadgeStyle } from "./badge.js";
import type {
    ResolvedBadgeStyle,
    ResolvedIcon,
    TaxonomyCategory,
    TaxonomyFieldMappings,
    TaxonomyIconsConfig,
    TaxonomyIconVariant,
    TaxonomySurface,
} from "./types.js";
import { ensureProfileSpriteInjectedSync } from "../../utils/loaders/profile-sprite-loader.js";

/** Builds the object mounted on `GeoLeaf.Taxonomy`. */
export function buildPublicApi() {
    return {
        /**
         * Whether the capability is active. Opt-out: `true` unless the profile
         * explicitly sets `modules.taxonomy.enabled: false`.
         */
        isEnabled: (): boolean => getTaxonomyConfig().enabled !== false,

        /**
         * Returns the shared sprite / icon config (`modules.taxonomy.icons`), or
         * `null` when absent or the capability is disabled. Source of truth for the
         * sprite loader (`spriteUrl`), the symbol layer's `icon-size` and the
         * legend's `showOnMap` gate.
         */
        getIcons: (): TaxonomyIconsConfig | null => {
            const cfg = getTaxonomyConfig();
            return cfg.enabled === false ? null : (cfg.icons ?? null);
        },

        /**
         * Resolves the icon a POI point should display on the map.
         *
         * ⚠ The returned `symbolId` is a MapLibre ATLAS id — tinted when the
         * category declares an `iconColor`. Not interchangeable with the DOM id
         * returned by {@link resolveTitleIcon}.
         *
         * @param poi - The POI/feature (carries `layerId` + category fields).
         */
        resolvePoiIcon: (poi: TaxonomyFeatureLike): ResolvedIcon =>
            _resolvePoiIcon(getTaxonomyConfig(), poi),

        /**
         * Every (icon × tint) pair the config references, for the MapLibre adapter
         * to rasterise and register. Empty when nothing is tinted.
         */
        getIconVariants: (): TaxonomyIconVariant[] => _resolveIconVariants(getTaxonomyConfig()),

        /**
         * Returns the `value → symbol` table of a named taxonomy (empty when the
         * taxonomy is unknown or the capability is disabled). Read by legend/filter.
         *
         * @param ref - Taxonomy name under `taxonomies`.
         */
        getCategories: (ref: string): Record<string, TaxonomyCategory> => {
            const cfg = getTaxonomyConfig();
            return cfg.enabled === false ? {} : (cfg.taxonomies?.[ref]?.categories ?? {});
        },

        /**
         * Returns the raw-value → category/sub-category translation table of a
         * named taxonomy (empty when unknown or the capability is disabled). Read by
         * the legend generator to resolve icons for style rules keyed on a raw source
         * attribute (e.g. `fclass`).
         *
         * @param ref - Taxonomy name under `taxonomies`.
         */
        getFieldMappings: (ref: string): TaxonomyFieldMappings => {
            const cfg = getTaxonomyConfig();
            return cfg.enabled === false ? {} : (cfg.taxonomies?.[ref]?.fieldMappings ?? {});
        },

        /**
         * Returns the categories bound to a LAYER, resolving `layers.<id>.use` for the
         * caller. Empty when the layer has no binding, the binding names an unknown
         * taxonomy, or the capability is disabled.
         *
         * Prefer this over {@link getCategories} whenever you start from a layer:
         * `getCategories` needs a taxonomy `ref`, which only the `layers` mapping knows.
         * Reading that mapping from outside means duplicating `resolveLayerBinding` —
         * which is how the AddPOI form ended up reading a profile key that never
         * existed and silently rendering no category fields at all (dette C-8).
         *
         * @param layerId - GeoLeaf layer id.
         */
        getLayerCategories: (layerId: string): Record<string, TaxonomyCategory> => {
            // The `enabled` gate is applied here, not in resolveLayerBinding: that helper
            // is a pure binding lookup and knows nothing about opt-out. Every other reader
            // on this facade gates the same way — a disabled capability shows nothing.
            const cfg = getTaxonomyConfig();
            if (cfg.enabled === false) return {};
            return _resolveLayerBinding(cfg, layerId)?.def.categories ?? {};
        },

        /**
         * The paint overrides that draw the marker disc under a point layer's icons.
         *
         * Returns only the keys taxonomy has something to say about, already spliced
         * into the layer's existing paint: a `["case", …]` from the layer's style
         * rules keeps all its branches and only has its DEFAULT swapped. `null` when
         * taxonomy has nothing to say (disabled, unbound, or no `marker` declared).
         *
         * @param layerId - GeoLeaf layer id.
         * @param existingPaint - The circle paint as built by the style converter.
         */
        resolveMarkerPaint: (
            layerId: string,
            existingPaint: Record<string, unknown>
        ): Record<string, unknown> | null =>
            _buildMarkerPaint(getTaxonomyConfig(), layerId, existingPaint),

        /**
         * Resolves the sprite `symbolId` of the icon to show next to a feature's
         * TITLE on a feature-info surface, honouring the per-surface `render` flags
         * (priority sub-category → category → default).
         *
         * ⚠ Returns the RAW id, for `<use href="#…">` against the DOM sprite. Not
         * interchangeable with the tinted atlas id from {@link resolvePoiIcon}.
         *
         * @param layerId - GeoLeaf layer id.
         * @param feature - Raw feature bag (read for category/sub-category values).
         * @param surface - The feature-info surface being rendered.
         */
        resolveTitleIcon: (
            layerId: string,
            feature: TaxonomyFeatureLike,
            surface: TaxonomySurface
        ): string | null => _resolveTitleIcon(getTaxonomyConfig(), layerId, feature, surface),

        /**
         * Resolves the colours of a category / sub-category pill badge, when the
         * surface opted in via `render.<surface>.colorBadges`. Taxonomy decides,
         * feature-info paints. Colours are validated here — the caller can assign
         * them straight to the DOM.
         *
         * @param layerId - GeoLeaf layer id.
         * @param feature - Raw feature bag.
         * @param surface - The feature-info surface being rendered.
         * @param field - The badge field's configured name (e.g. `properties.categoryId`).
         */
        resolveBadgeStyle: (
            layerId: string,
            feature: TaxonomyFeatureLike,
            surface: TaxonomySurface,
            field: string
        ): ResolvedBadgeStyle | null =>
            _resolveBadgeStyle(getTaxonomyConfig(), layerId, feature, surface, field),

        /**
         * Ensures the active profile's SVG sprite (its `<symbol>` defs) is present
         * in the DOM so a `<use href="#…">` can reference it. Fire-and-forget and
         * idempotent (the loader dedupes). Consumed by `feature-info` before
         * injecting a category glyph on a surface that may render before any map
         * icon layer has triggered the sprite injection.
         */
        ensureSprite: (): void => {
            void ensureProfileSpriteInjectedSync();
        },
    };
}
