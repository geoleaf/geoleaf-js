/*!
 * @geoleaf-plugins/measure — Config
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { MeasureConfig, MeasureType, DistanceUnit, AreaUnit } from "./types.js";
import { coreConfigGet } from "@geoleaf/host-runtime";

const ALL_TOOLS: MeasureType[] = [
    "distance",
    "rect",
    "circle",
    "polygon",
    "gps",
    "annotation-tooltip",
];

/** Default values for measureConfig (mirrors CDC §1.7). */
const MEASURE_CONFIG_DEFAULTS: MeasureConfig = {
    enabled: true,
    showButton: true,
    position: "left",
    menuPosition: "top-left",
    defaultDistanceUnit: "m",
    defaultAreaUnit: "m2",
    snapPx: 12,
    circleSteps: 64,
    enabledTools: [...ALL_TOOLS],
    tooltipDefaultSize: { width: 160, height: 80 },
    labelMaxChars: 120,
    persist: true,
    storageKey: "geoleaf.measure.fc",
    maxFeatures: 500,
    gpsCloseThresholdM: 15,
    gpsMaxJumpMps: 25,
    decimals: { distance: 0, area: 0 },
    exportFileName: "mesures.geojson",
};

/**
 * Narrows `menuPosition` to the two shapes the CDC §1.7 documents: an explicit
 * `{top,left}` pixel pair, or the literal `"top-left"`.
 *
 * PLUGINS S5 — this validation did not exist, despite CDC §2.12 claiming it did: `raw`
 * was spread verbatim into the result, so any value reached `_applyPosition`, which
 * silently treated everything non-object as top-left. An unsupported corner now warns
 * instead of being applied wrong without a word.
 */
function _normalizeMenuPosition(raw: unknown): MeasureConfig["menuPosition"] {
    if (raw == null) return MEASURE_CONFIG_DEFAULTS.menuPosition;
    if (typeof raw === "object") {
        const pos = raw as { top?: unknown; left?: unknown };
        if (typeof pos.top === "number" && typeof pos.left === "number") {
            return { top: pos.top, left: pos.left };
        }
    } else if (raw === "top-left") {
        return "top-left";
    }
    console.warn(
        `[GeoLeaf.Measure] menuPosition: unsupported value ${JSON.stringify(raw)} — ` +
            `expected "top-left" or { top, left }. Falling back to the default.`
    );
    return MEASURE_CONFIG_DEFAULTS.menuPosition;
}

/** Returns the merged measureConfig (profile values over defaults). */
export function getMeasureConfig(): MeasureConfig {
    // Plugin settings now live under `modules.measure.*` (INV-CONFIG). The core S0
    // mirror keeps the legacy root key `measureConfig.*` in sync during the
    // deprecation window, so both shapes resolve here.
    const raw = (coreConfigGet<Partial<MeasureConfig>>("modules.measure", {}) ??
        {}) as Partial<MeasureConfig>;

    // Alias: showButton ↔ ui.showMeasure. `ui` stays a CORE-level key (also read by
    // the toolbar registry via profileKey "ui.showMeasure") — not migrated to modules.
    const ui = coreConfigGet<{ showMeasure?: boolean }>("ui", {});
    const showButton = raw.showButton ?? ui?.showMeasure ?? MEASURE_CONFIG_DEFAULTS.showButton;

    // Validate and filter enabledTools
    const enabledToolsRaw = raw.enabledTools;
    const enabledTools = Array.isArray(enabledToolsRaw)
        ? (enabledToolsRaw.filter((t) => ALL_TOOLS.includes(t as MeasureType)) as MeasureType[])
        : MEASURE_CONFIG_DEFAULTS.enabledTools;

    // Clamp numeric bounds
    const snapPx = Math.max(1, Number(raw.snapPx ?? MEASURE_CONFIG_DEFAULTS.snapPx) || 1);
    const circleSteps = Math.min(
        256,
        Math.max(8, Number(raw.circleSteps ?? MEASURE_CONFIG_DEFAULTS.circleSteps) || 64)
    );
    const maxFeatures = Math.max(
        1,
        Number(raw.maxFeatures ?? MEASURE_CONFIG_DEFAULTS.maxFeatures) || 500
    );
    const gpsCloseThresholdM = Math.max(
        1,
        Number(raw.gpsCloseThresholdM ?? MEASURE_CONFIG_DEFAULTS.gpsCloseThresholdM) || 15
    );
    const gpsMaxJumpMps = Math.max(
        1,
        Number(raw.gpsMaxJumpMps ?? MEASURE_CONFIG_DEFAULTS.gpsMaxJumpMps) || 25
    );

    // Validate unit values
    const validDistanceUnits: DistanceUnit[] = ["m", "km", "auto"];
    const validAreaUnits: AreaUnit[] = ["m2", "ha", "km2", "auto"];
    const defaultDistanceUnit = validDistanceUnits.includes(raw.defaultDistanceUnit as DistanceUnit)
        ? (raw.defaultDistanceUnit as DistanceUnit)
        : MEASURE_CONFIG_DEFAULTS.defaultDistanceUnit;
    const defaultAreaUnit = validAreaUnits.includes(raw.defaultAreaUnit as AreaUnit)
        ? (raw.defaultAreaUnit as AreaUnit)
        : MEASURE_CONFIG_DEFAULTS.defaultAreaUnit;

    return {
        ...MEASURE_CONFIG_DEFAULTS,
        ...raw,
        showButton,
        menuPosition: _normalizeMenuPosition(raw.menuPosition),
        enabledTools,
        snapPx,
        circleSteps,
        maxFeatures,
        gpsCloseThresholdM,
        gpsMaxJumpMps,
        defaultDistanceUnit,
        defaultAreaUnit,
    } as MeasureConfig;
}
