/*!
 * @geoleaf-plugins/editor — Terra Draw snapping helpers
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
// Terra Draw does not re-export the Snapping type from its main index.
// Redefined here to avoid a fragile deep-import.
interface SnappingConfig {
    toLine?: boolean;
    toCoordinate?: boolean;
}

/**
 * Terra Draw Snapping config for polygon + polyline closing-snap.
 * The `toLine` and `toCoordinate` flags enable snap-to-geometry;
 * Terra Draw uses the mode's `pointerDistance` (px) to control the snap radius.
 */
export function buildSnappingConfig(): SnappingConfig {
    return {
        toLine: true,
        toCoordinate: true,
    };
}
