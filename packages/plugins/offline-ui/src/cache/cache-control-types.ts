/*!
 * GeoLeaf Storage - Cache Control Types
 * Shared contract + event vocabulary for the cache-control hub.
 * Leaf module: imports NOTHING from the cache-control sub-modules — the sub-modules
 * import their shared types from here instead of from the assembler, which is what
 * turns cache-control.ts into a plain assembler/view.
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

// ─── Event vocabulary (single source of truth) ───────────────────────

/**
 * Document-level cache events. Emitted by the downloader / storage /
 * progress-tracker and observed by `cache-control-events`. Centralised here so
 * emitters and listeners share one spelling.
 */
export const CACHE_EVENTS = {
    COMPLETED: "geoleaf:cache:completed",
    CLEARED: "geoleaf:cache:cleared",
    CANCELLED: "geoleaf:cache:cancelled",
    PROGRESS: "geoleaf:cache:progress",
    CLEAR_PROGRESS: "geoleaf:cache:clear-progress",
    PROFILE_LOADED: "geoleaf:profile:loaded",
} as const;

// ─── Public types ────────────────────────────────────────────────────

/**
 * How the offline cache control renders and what it caches.
 */
export interface CacheControlOptions {
    position?: string;
    collapsed?: boolean;
    collapsible?: boolean;
}

/**
 * Payload of a cache progress event: where the download has got to.
 *
 * Emitted per batch rather than per tile — a region can be tens of thousands of tiles, and one
 * event each would cost more than the download.
 */
export interface CacheProgressDetail {
    current?: number;
    total?: number;
    downloadedSize?: number;
    totalSize?: number;
    speed?: number;
    eta?: number;
}

/** Shared state object passed to every sub-module function. */
export interface CacheControlState {
    options: CacheControlOptions & {
        position?: string;
        collapsed?: boolean;
        collapsible?: boolean;
    };
    _eventCleanups: (number | (() => void))[];
    _map?: unknown;
    _container?: HTMLElement | null;
    _bodyEl?: HTMLElement | null;
    _toggleBtn?: HTMLButtonElement | null;
    _layersContent?: HTMLElement | null;
    _layersToggleBtn?: HTMLButtonElement | null;
    _statusToggleBtn?: HTMLButtonElement | null;
    _downloadBtn?: HTMLButtonElement | null;
    _clearBtn?: HTMLButtonElement | null;
    _stopBtn?: HTMLButtonElement | null;
    _progressEl?: HTMLElement | null;
    _progressFill?: HTMLElement | null;
    _progressText?: HTMLElement | null;
    // Vector download zone (S3)
    _zoneToggleBtn?: HTMLButtonElement | null;
    _zoneContent?: HTMLElement | null;
    _zoneSummaryEl?: HTMLElement | null;
    _zoneEstimateEl?: HTMLElement | null;
    _zoomCeilingSelect?: HTMLSelectElement | null;
    // Bound method references (set once, called by sub-modules via self)
    _buildStructure(): void;
    _attachEventListeners(): void;
    _updateStatus(): Promise<void>;
    _updateProgress(progress: CacheProgressDetail): void;
    _updateClearProgress(progress: CacheProgressDetail): void;
    _populateLayerSelection(): Promise<void>;
    _cleanup(): void;
    _handleDownload(): Promise<void>;
    _handleClear(): Promise<void>;
    _handleStop(): void;
    _handleLayersToggle(): void;
    _handleStatusToggle(): void;
    _handleCancelled(): void;
    _toggleCollapsed(): void;
}
