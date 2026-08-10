/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `taxonomy` capability.
 *
 * Registered in `boot.ts` before the optional module gate so that
 * `GeoLeaf.Introspection.getAllCapabilities()` and `getCapabilitySchema('taxonomy')`
 * work at runtime.
 *
 * Config gate: `modules.taxonomy.enabled` — OPT-OUT (`enableWhenAbsent: true`).
 * The key lives in a profile RESOURCE, loaded AFTER the boot gate reads the
 * pre-merge config; an opt-in gate would read `undefined` and silence the
 * capability for every profile. Only an explicit `false` disables it — and then
 * it disables EVERYTHING: map icons, marker discs, pill badges, legend icons and
 * the filter's category options.
 *
 * `configSchema` covers the FOUR sub-trees the runtime reads (B.41 — it used to
 * declare `enabled` alone, 1 key out of ~19 consumed, leaving the whole taxonomy
 * invisible to `getCapabilitySchema('taxonomy')` and therefore to the no-code
 * studio). Every `default` below is the value the code applies, cited at its read
 * site; where the code applies none, none is advertised. `taxonomies` and `layers`
 * are declared WITHOUT `properties`: their keys are user data (taxonomy names, layer
 * ids), so enumerating them is meaningless — same treatment as the opaque `mapping`
 * leaf of `check-config-coverage.cjs`.
 */
"use strict";

import type {
    ICapabilityDeclaration,
    ICapabilityFieldSchema,
} from "../../contracts/capability.contract.js";

/**
 * Per-surface decoration toggles — the same three flags for `popup` / `tooltip` /
 * `sidepanel`. All default to `false`: `resolveTitleIcon` returns `null` unless a flag
 * is `=== true` (`resolveTitleIcon`) and `resolveBadgeStyle` returns `null` unless
 * `colorBadges === true` (`resolveBadgeStyle`) — absent means "surface unchanged".
 */
const SURFACE_RENDER_FIELD: ICapabilityFieldSchema = {
    type: "object",
    description: "Category / sub-category decorations shown on this feature-info surface.",
    properties: {
        showIconCategory: {
            type: "boolean",
            default: false,
            description: "Show the category icon next to the title (`resolveTitleIcon`).",
        },
        showIconSubcategory: {
            type: "boolean",
            default: false,
            description: "Show the sub-category icon next to the title (`resolveTitleIcon`).",
        },
        colorBadges: {
            type: "boolean",
            default: false,
            description: "Colour the category / sub-category pill badges (`resolveBadgeStyle`).",
        },
    },
};

/** In-core capability declaration for the Taxonomy subsystem. */
export const TAXONOMY_CAPABILITY: ICapabilityDeclaration = {
    id: "taxonomy",
    label: "Taxonomy",
    description:
        "Point symbol driven by a value→symbol mapping: icon, icon colour, marker disc and feature-info pill badges.",
    gate: { configPath: "modules.taxonomy.enabled", enableWhenAbsent: true },
    configSchema: {
        enabled: {
            type: "boolean",
            default: true,
            description: "Enable the point-symbol taxonomy (opt-out — set false to silence it).",
        },
        icons: {
            type: "object",
            description:
                "Sprite / icon config shared by every taxonomy. The block itself is the icon " +
                "gate: absent, the legend shows no icon at all (`getIconFromTaxonomy`).",
            properties: {
                spriteUrl: {
                    type: "string",
                    description:
                        "URL of the profile sprite SVG, relative to the deployment. No default " +
                        "— absent, the sprite is not injected and no icon resolves " +
                        "(`profile-sprite-loader.ts` → `_getSpriteUrl`).",
                },
                symbolPrefix: {
                    type: "string",
                    default: "",
                    description:
                        "Prefix prepended to each `svgId` to form the `<symbol>` id. Do NOT " +
                        "repeat it inside `svgId` — that yields a doubled, non-existent id " +
                        "(`resolvePoiIcon`, `resolveTitleIcon`, `resolveIconVariants`).",
                },
                defaultIcon: {
                    type: "string",
                    description:
                        "`svgId` used when a category resolves no icon of its own. No default " +
                        "— absent, such a feature simply gets no icon (`resolvePoiIcon`).",
                },
                iconSize: {
                    type: "number",
                    default: 0.5,
                    description:
                        "MapLibre `icon-size` of the symbol sub-layer. Only a number > 0 is " +
                        "honoured (`maplibre-taxonomy-paint.ts` → `resolveIconSize`).",
                },
                showOnMap: {
                    type: "boolean",
                    default: true,
                    description:
                        "Show category icons on the map / in the legend. Only an explicit " +
                        "`false` turns them off (`getIconFromTaxonomy`) — but the enclosing " +
                        "`icons` block must be present for icons to show at all.",
                },
            },
        },
        render: {
            type: "object",
            description:
                "Per-surface decoration toggles, consumed by `feature-info` through the " +
                "`GeoLeaf.Taxonomy` seam (taxonomy owns the decision, feature-info the DOM).",
            properties: {
                popup: SURFACE_RENDER_FIELD,
                tooltip: SURFACE_RENDER_FIELD,
                sidepanel: SURFACE_RENDER_FIELD,
            },
        },
        taxonomies: {
            type: "object",
            description:
                "Named, reusable taxonomies keyed by taxonomy name (user data — no fixed " +
                "keys). Each entry: `categoryField` (required), optional `subCategoryField`, " +
                "a `categories` table (`svgId` / `iconColor` / `marker` / `label` / " +
                "`subcategories`) and an optional `fieldMappings` translation table.",
        },
        layers: {
            type: "object",
            description:
                "Per-layer bindings keyed by GeoLeaf layer id (user data — no fixed keys). " +
                "Each entry: `use` (name of a `taxonomies` entry) plus optional " +
                "`categoryField` / `subCategoryField` overrides. A layer absent from this map " +
                "is unbound: taxonomy resolves nothing for its features (resolver.ts).",
        },
    },
    // No loader: taxonomy is inline (quasi-universal, light) and purely pull-based —
    // it owns no module and no lifecycle; consumers call it, it subscribes to nothing.
};
