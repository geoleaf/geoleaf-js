/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Core (feature-info capability) — Shared types
 *
 * The capability's own type surface: the legacy per-layer binding, the two kernel
 * event payloads, the side-panel layout override, and the public façade.
 *
 * ⚠️ This file used to declare TWO parallel type vocabularies of its own — a
 * `FieldType` union of 17 members against the 24 the engine renders, and a
 * `FieldStyle` union of 29 values of which 3 were branched. Both are gone at the
 * Sprint 2 deletion pass: the descriptor now points at the contract, which is the
 * one list a schema and a gate can confront. Five parallel vocabularies were
 * measured at the pre-flight; this removes two of them.
 */

import type { AttributeEmphasis, AttributeWidget } from "../../contracts/attributes.contract.js";

/**
 * Field list for a single surface: hidden, or an explicit list.
 *
 * ⚠️ `"all"` was a third member until 02/08/2026. It is retired by decision U2 — see
 * `convert.ts` for what it actually did, which was not what its name said.
 */
type SurfaceConfig = false | readonly FeatureInfoFieldConfig[];

/** Descriptor for a single field to display in tooltip / popup / side-panel. */
export interface FeatureInfoFieldConfig {
    /**
     * Property key to read. Accepts a dotted path resolved against the
     * normalized `{ properties, attributes }` feature model — e.g.
     * `"properties.Name"`, `"attributes.photo"` (see `resolve.ts`).
     */
    readonly field: string;
    /** Human-readable label. Defaults to the raw `field` key when omitted. */
    readonly label?: string;
    /**
     * Which widget renders the value. Defaults to `"text"`.
     *
     * ⚠️ Typed by the CONTRACT rather than by a local union. `FieldType` lived here
     * and declared 17 members against the 24 the engine renders — one of the five
     * parallel type vocabularies the pre-flight found, and the one that made `date`,
     * `url` and `email` "declared but rendered nowhere". A single list cannot
     * diverge from itself.
     */
    readonly type?: AttributeWidget;
    /**
     * Visual emphasis.
     *
     * ⚠️ Typed by the CONTRACT. The local `FieldStyle` declared **29** values of
     * which **3** were branched, and the other 26 produced neither a branch nor a
     * CSS class — measured, twice, a week apart.
     */
    readonly style?: AttributeEmphasis;
    /**
     * Pre-type presentation hint carried verbatim from the authored config;
     * normalized by the render engine (legacy parity): `hero` (image → hero),
     * `title` (text → title emphasis), `multiline` (text → longtext).
     */
    readonly variant?: "hero" | "title" | "multiline";
    /** When `true`, the field is never rendered. */
    readonly hidden?: boolean;
    /** Identifier dispatched with `geoleaf:popup:action` for `type: "action"`. */
    readonly actionId?: string;
    /** Side-panel only: wrap this field in a collapsible `<details>` section. */
    readonly accordion?: boolean;
    /** Side-panel only: when `accordion`, render the section expanded initially. */
    readonly defaultOpen?: boolean;
}

/** Per-layer capability config read from `layers.<id>.capabilities.feature-info`. */
export interface FeatureInfoLayerBinding {
    /** Property key used as the popup / side-panel title. Defaults to "name". */
    readonly titleField?: string;
    /** Fields shown in the hover tooltip (rendered in `"safe"` mode). */
    readonly tooltip?: SurfaceConfig;
    /** Fields shown in the click popup (rendered in `"full"` mode). */
    readonly popup?: SurfaceConfig;
    /** Fields shown in the side-panel (rendered in `"full"` mode). */
    readonly sidepanel?: SurfaceConfig;
}

/** Capability-level config read from `modules.feature-info`. */
export interface FeatureInfoConfig {
    /** Gate — the capability is inert when `false` or absent. */
    readonly enabled: boolean;
}

/** `geoleaf:feature:click` kernel seam event detail. */
export interface GeoLeafFeatureClickDetail {
    readonly layerId: string;
    readonly featureId: string | number | null;
    readonly properties: Record<string, unknown>;
    readonly geometry: { readonly type: string; readonly coordinates?: unknown } | null;
    readonly lngLat: { readonly lat: number; readonly lng: number };
    readonly point: { readonly x: number; readonly y: number };
}

/** `geoleaf:feature:hover` kernel seam event detail. */
export interface GeoLeafFeatureHoverDetail {
    readonly layerId: string;
    readonly featureId: string | number | null;
    readonly properties: Record<string, unknown>;
    readonly lngLat: { readonly lat: number; readonly lng: number };
    readonly point: { readonly x: number; readonly y: number };
    readonly zIndex: number;
    readonly phase: "move" | "leave";
}

/** Resolved layout handed to the side-panel when opened programmatically or via injection. */
export interface SidePanelLayout {
    readonly layerId: string;
    readonly fields: readonly FeatureInfoFieldConfig[];
    readonly titleField?: string;
    readonly lngLat?: { readonly lng: number; readonly lat: number };
    readonly featureId?: string | number;
}

/**
 * Injection contract consumed by core's thin side-panel delegate
 * (`core/src/contracts/sidepanel-renderer.contract.ts`, Sprint 3). The plugin's
 * public API is itself this contract — no import relationship across the
 * plugin/core boundary, only a structurally-compatible shape on each side.
 */
export interface ISidePanelRenderer {
    readonly openSidePanel: (detail: GeoLeafFeatureClickDetail, layout?: SidePanelLayout) => void;
    readonly closeSidePanel: () => void;
    readonly isSidePanelOpen: () => boolean;
}

/** `GeoLeaf.FeatureInfo` public façade (5 methods, v2.1.0). */
export interface FeatureInfoPublicApi {
    /** `true` when `modules.feature-info.enabled`. */
    readonly isEnabled: () => boolean;
    /**
     * Closes both the popup **and** the side-panel, whichever is open. A no-op when neither
     * is — it is safe to call unconditionally, e.g. on a route change or a modal opening.
     *
     * ⚠️ **This method is deliberately NOT gated on `modules.feature-info.enabled`**, unlike
     * the four others. Flipping the key to `false` while a surface is open must not strand a
     * panel that no API can then close.
     *
     * @example
     * ```ts
     * GeoLeaf?.FeatureInfo?.close();
     * ```
     */
    readonly close: () => void;
    /**
     * Opens the popup at the click point. `layout` overrides the auto-resolved
     * layer binding — used by callers with no `layers.<id>.capabilities.feature-info`
     * config of their own (POI injection, Sprint 3). "Voir plus" reuses the
     * same override when opening the side-panel, so an overridden popup never
     * falls back to a generic auto-resolved side-panel.
     */
    readonly openPopup: (detail: GeoLeafFeatureClickDetail, layout?: SidePanelLayout) => void;
    /** Opens the side-panel — programmatic call or POI injection. */
    readonly openSidePanel: (detail: GeoLeafFeatureClickDetail, layout?: SidePanelLayout) => void;
    /** Layer binding config, or `null` when the layer has no feature-info config. */
    readonly getConfig: (layerId: string) => FeatureInfoLayerBinding | null;
}
