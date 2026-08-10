/*!
 * GeoLeaf Core (feature-info capability) — Core layer-config accessor
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Reads a loaded layer's authored config from the running core via the mounted
 * `GeoLeaf.GeoJSON.getLayerConfig(id)` seam. Returns `null` when the accessor or
 * the layer is absent. Per-layer feature-info bindings live under this config's
 * `capabilities.feature-info` (v2.2.0+ canonical form).
 *
 * This read stays on the runtime seam (rather than a static `GeoJSONCore` import)
 * so the ported render pipeline behaves byte-identically to the pre-reclassification
 * plugin.
 *
 * @param layerId GeoLeaf layer id.
 */
export function coreLayerConfigGet(layerId: string): Record<string, unknown> | null {
    const g = globalThis as {
        GeoLeaf?: { GeoJSON?: { getLayerConfig?: (id: string) => unknown } };
    };
    const cfg = g.GeoLeaf?.GeoJSON?.getLayerConfig?.(layerId);
    return cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : null;
}
