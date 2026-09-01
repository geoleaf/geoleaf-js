/*!
 * @geoleaf-plugins/print — Config
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { coreConfigGet } from "@geoleaf/host-runtime";

/** Default values for printConfig (mirrors CDC §1.6). */
const PRINT_CONFIG_DEFAULTS = {
    enabled: true,
    showButton: true,
    position: "left" as const,
    defaultFormat: "A4",
    availableFormats: ["A4", "A3"] as string[],
    dpi: 300,
    availableDpi: [300] as number[],
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
    includeLegend: false,
    includeScale: true,
    includeNorthArrow: true,
    includeAnnotations: true,
    title: "",
    exportFormats: ["pdf", "jpg"] as string[],
    jpgQuality: 0.92,
    serverEndpoint: undefined as string | undefined,
    serverHeaders: {} as Record<string, string>,
    forceServer: false,
    maxCanvasPxMobile: 16_000_000,
} as const;

/**
 * Print options: page format, orientation, resolution and what is included.
 */
export interface PrintConfig {
    enabled: boolean;
    showButton: boolean;
    position: string;
    defaultFormat: string;
    availableFormats: string[];
    dpi: number;
    availableDpi: number[];
    margins: { top: number; right: number; bottom: number; left: number };
    includeLegend: boolean;
    includeScale: boolean;
    includeNorthArrow: boolean;
    /** Include measure annotations in the print output (only when plugin-measure is loaded). */
    includeAnnotations: boolean;
    title: string;
    exportFormats: string[];
    jpgQuality: number;
    serverEndpoint: string | undefined;
    serverHeaders: Record<string, string>;
    forceServer: boolean;
    maxCanvasPxMobile: number;
}

/** Returns the merged printConfig (profile values over defaults). */
export function getPrintConfig(): PrintConfig {
    // Plugin settings live under `modules.print.*` (INV-CONFIG) — and ONLY there.
    //
    // ⚠️ This comment claimed a "core S0 mirror" kept the legacy root key `printConfig.*`
    // in sync "during the deprecation window". That window is closed: the core CHANGELOG
    // lists `printConfig` at the profile root among the root-level plugin keys REMOVED as
    // a breaking change, and `grep printConfig` over every `src/` and every profile
    // returns zero. Only one path is read, and it is the one below.
    const raw = coreConfigGet<Partial<PrintConfig>>("modules.print", {}) ?? {};
    return { ...PRINT_CONFIG_DEFAULTS, ...raw } as PrintConfig;
}
