/*!
 * GeoLeaf Storage - Cache Control Zone (S3 vector offline)
 * Download-zone selector: bbox (current view / profile area) + zoom ceiling.
 * Persists a `vectorZone` into the saved selection, consumed by StyleResolver.
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { Log } from "@geoleaf/host-runtime";
import { coreConfigGet as configGet } from "@geoleaf/host-runtime";
import { StorageContract } from "../shared/storage-contract.js";
// LOCAL module: the symbol was pruned from the core's published bundle, which
// calls it nowhere. See the header of `sync/vector-zone-estimate.ts`.
import { estimateVectorZone } from "../sync/vector-zone-estimate.js";
import { proposeCorridor } from "./corridor-selection.js";
import { formatFileSize } from "../utils/core-utils.js";
import { createElement } from "../utils/dom-helpers.js";
import { tLabel as t } from "@geoleaf/host-runtime";

import type { CacheControlState } from "./cache-control-types.js";
import type {
    SavedSelection,
    SelectionBounds,
    VectorZone,
} from "./layer-selector/layer-selector-types.js";

/** Zoom ceilings offered in the selector (default = 14, MapLibre overzooms to ~18). */
const ZOOM_CEILINGS = [12, 13, 14, 15, 16];
const DEFAULT_CEILING = 14;
/** Min zoom floor for a "profile area" download (the view path uses the live zoom). */
const PROFILE_MIN_ZOOM = 8;

/**
 * Bounds returned by the map. The GeoLeaf map adapter returns a plain
 * `GeoLeafBounds` (`{north,south,east,west}`); a raw MapLibre map returns a
 * `LngLatBounds` (method-style). `readBounds` accepts either.
 */
type MlBounds =
    | { getNorth(): number; getSouth(): number; getEast(): number; getWest(): number }
    | { north: number; south: number; east: number; west: number };
interface MlMap {
    getBounds(): MlBounds;
    getZoom(): number;
    getMaxBounds?(): MlBounds | null;
}

/** Normalises either bounds shape to plain {north,south,east,west}. */
function readBounds(b: MlBounds): SelectionBounds {
    const m = b as { getNorth?: () => number };
    if (typeof m.getNorth === "function") {
        const f = b as {
            getNorth(): number;
            getSouth(): number;
            getEast(): number;
            getWest(): number;
        };
        return { north: f.getNorth(), south: f.getSouth(), east: f.getEast(), west: f.getWest() };
    }
    const p = b as { north: number; south: number; east: number; west: number };
    return { north: p.north, south: p.south, east: p.east, west: p.west };
}

// ─── DOM ─────────────────────────────────────────────────────────────

/** Builds the ZONE accordion (bbox buttons + zoom ceiling + estimate). */
export function buildZoneSelectionSection(self: CacheControlState, parentEl: HTMLElement): void {
    const section = createElement("div", "gl-cache-zone", parentEl);

    // Header + toggle (mirrors the STATUS/CONFIG accordions).
    const header = createElement("div", "gl-cache-zone__header", section);
    const titleEl = createElement("div", "gl-cache-zone__title", header);
    const icon = document.createElement("span");
    icon.className = "gl-cache-zone__icon";
    icon.textContent = "\u{1F5FA}️";
    const label = document.createElement("span");
    label.className = "gl-cache-zone__label";
    label.textContent = t("storage.zone.title");
    titleEl.appendChild(icon);
    titleEl.appendChild(label);

    const toggleBtn = createElement("button", "gl-cache-zone__toggle", header);
    self._zoneToggleBtn = toggleBtn;
    toggleBtn.type = "button";
    toggleBtn.textContent = "▼";
    toggleBtn.setAttribute("aria-label", t("storage.zone.title"));

    const content = createElement("div", "gl-cache-zone__content", section);
    self._zoneContent = content;
    content.style.display = "block";
    toggleBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const collapsed = content.classList.toggle("gl-cache-collapsible--collapsed");
        toggleBtn.textContent = collapsed ? "▲" : "▼";
    });

    // bbox source buttons.
    const buttons = createElement("div", "gl-cache-zone__buttons", content);

    const viewBtn = createElement("button", "gl-btn gl-btn--secondary", buttons);
    viewBtn.type = "button";
    viewBtn.textContent = t("storage.zone.useCurrentView");
    viewBtn.addEventListener("click", () => void applyZone(self, "view"));

    const profileBtn = createElement("button", "gl-btn gl-btn--secondary", buttons);
    profileBtn.type = "button";
    profileBtn.textContent = t("storage.zone.useProfileArea");
    profileBtn.addEventListener("click", () => void applyZone(self, "profile"));

    // Third mode — the corridor of the last prepared itinerary.
    //
    // ⛔ It ADDS to the other two, it does not replace them: on an axis-aligned
    // line, the bbox stays cheaper at ALL zooms (measured,
    // `scripts/probe-corridor-cost.mjs`). Offering the corridor alone would make
    // coastal roads, valleys and motorways pay more — a whole swath of ordinary
    // trips.
    const corridorBtn = createElement("button", "gl-btn gl-btn--secondary", buttons);
    corridorBtn.type = "button";
    corridorBtn.textContent = t("storage.zone.useRouteCorridor");
    corridorBtn.addEventListener("click", () => void applyCorridor(self, corridorBtn));

    // Zoom ceiling selector.
    const zoomRow = createElement("div", "gl-cache-zone__row", content);
    const zoomLabel = document.createElement("label");
    zoomLabel.className = "gl-cache-zone__row-label";
    zoomLabel.textContent = t("storage.zone.zoomCeiling");
    const select = document.createElement("select");
    select.className = "gl-cache-zone__zoom-select";
    for (const z of ZOOM_CEILINGS) {
        const opt = document.createElement("option");
        opt.value = String(z);
        opt.textContent = `z${z}`;
        if (z === DEFAULT_CEILING) opt.selected = true;
        select.appendChild(opt);
    }
    self._zoomCeilingSelect = select;
    zoomLabel.appendChild(select);
    zoomRow.appendChild(zoomLabel);
    select.addEventListener("change", () => void onCeilingChange(self));

    const note = createElement("div", "gl-cache-zone__note", content);
    note.textContent = t("storage.zone.note");

    // bbox summary + estimate.
    const summary = createElement("div", "gl-cache-zone__summary", content);
    self._zoneSummaryEl = summary;
    summary.textContent = t("storage.zone.noZone");

    const estimate = createElement("div", "gl-cache-zone__estimate", content);
    self._zoneEstimateEl = estimate;
    estimate.textContent = "";

    // Restore any previously saved zone.
    void hydrateZone(self);
}

// ─── Behaviour ───────────────────────────────────────────────────────

/** Loads the saved zone (if any) and renders the summary/estimate. */
async function hydrateZone(self: CacheControlState): Promise<void> {
    const selection = await loadSelection();
    if (selection?.vectorZone) {
        if (self._zoomCeilingSelect) {
            self._zoomCeilingSelect.value = String(selection.vectorZone.cacheMaxZoom);
        }
        renderZone(self, selection.vectorZone);
    }
}

/** Captures a bbox from the map (view or profile) and persists it as the zone. */
async function applyZone(self: CacheControlState, source: "view" | "profile"): Promise<void> {
    const map = self._map as MlMap | null;
    if (!map || typeof map.getBounds !== "function") {
        Log?.warn("[CacheControl] No map available for zone selection");
        return;
    }

    const ceiling = currentCeiling(self);

    let mlBounds: MlBounds | null;
    let minZoom: number;

    if (source === "view") {
        mlBounds = map.getBounds();
        minZoom = Math.min(Math.floor(map.getZoom()), ceiling);
    } else {
        mlBounds = (map.getMaxBounds && map.getMaxBounds()) || map.getBounds();
        minZoom = Math.min(PROFILE_MIN_ZOOM, ceiling);
    }

    const bounds: SelectionBounds = readBounds(mlBounds);

    const zone: VectorZone = {
        bounds,
        cacheMinZoom: minZoom,
        cacheMaxZoom: ceiling,
        source,
    };

    await persistZone(zone);
    renderZone(self, zone);
    refreshSelectionTotals();
}

/** Default corridor buffer radius, in metres. The only "width" lever offered. */
const CORRIDOR_BUFFER_M = 500;

/** Corridor zoom floor: below it, the bbox path is cheaper. */
const CORRIDOR_MIN_ZOOM = 12;

/**
 * Proposes the last itinerary's corridor, and makes the verdict READABLE in the button.
 *
 * ⚠️ The refusal is written where the user just clicked, not in the console. A
 * mode failing silently reads as a broken button — and there is nothing else to
 * click to understand.
 *
 * @param self The control.
 * @param btn  The button, whose label carries the refusal if any.
 */
async function applyCorridor(self: CacheControlState, btn: HTMLButtonElement): Promise<void> {
    const ceiling = currentCeiling(self);
    const quota = await remainingQuota();
    const outcome = await proposeCorridor(
        CORRIDOR_BUFFER_M,
        Math.min(CORRIDOR_MIN_ZOOM, ceiling),
        ceiling,
        quota
    );

    if (!outcome.ok) {
        // 🛑 The refusal NAMES its levers with their weight. "Too large" without
        // saying what to lower shows a wall, not a dial — the step-cap refusal's
        // lesson, and it holds here word for word.
        const levers = (outcome.levers ?? [])
            .map((l) => `${t(`storage.zone.lever.${l.kind}`)} ${l.to} → ${formatFileSize(l.bytes)}`)
            .join(" · ");
        if (self._zoneEstimateEl) {
            self._zoneEstimateEl.textContent =
                t(`storage.zone.corridor.${outcome.reason}`) + (levers ? ` — ${levers}` : "");
        }
        return;
    }

    const { selection } = outcome;
    if (self._zoneSummaryEl) {
        self._zoneSummaryEl.textContent =
            `${t("storage.zone.corridorSummary")}: ${selection.routeId} · ` +
            `${selection.bufferMetres} m · z${selection.minZoom}–${selection.maxZoom}`;
    }
    if (self._zoneEstimateEl) {
        self._zoneEstimateEl.textContent =
            `${t("storage.zone.estimate")}: ~${formatFileSize(selection.bytes)} ` +
            `(${selection.tiles} ${t("storage.zone.tiles")})`;
    }
    btn.blur();
}

/**
 * What the browser still grants, in bytes.
 *
 * @returns The remaining bytes, or `Infinity` when unknown. ⚠️ **Never 0 by
 *          default**: refusing for lack of knowing would block a download that
 *          would have fit.
 */
async function remainingQuota(): Promise<number> {
    try {
        const manager = StorageContract.CacheManager;
        const q = await manager?.getStorageQuota?.();
        if (!q || !Number.isFinite(q.quota) || !Number.isFinite(q.usage)) {
            return Number.POSITIVE_INFINITY;
        }
        return Math.max(0, q.quota - q.usage);
    } catch {
        return Number.POSITIVE_INFINITY;
    }
}

/** Re-applies the current bbox with the newly chosen zoom ceiling. */
async function onCeilingChange(self: CacheControlState): Promise<void> {
    const selection = await loadSelection();
    const prior = selection?.vectorZone;
    if (!prior) return; // No bbox chosen yet — ceiling alone is meaningless.

    const ceiling = currentCeiling(self);
    const zone: VectorZone = {
        ...prior,
        cacheMaxZoom: ceiling,
        cacheMinZoom: Math.min(prior.cacheMinZoom, ceiling),
    };
    await persistZone(zone);
    renderZone(self, zone);
    refreshSelectionTotals();
}

function currentCeiling(self: CacheControlState): number {
    const raw = self._zoomCeilingSelect?.value;
    const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_CEILING;
    return Number.isFinite(parsed) ? parsed : DEFAULT_CEILING;
}

/** Renders the bbox summary + size estimate. */
function renderZone(self: CacheControlState, zone: VectorZone): void {
    if (self._zoneSummaryEl) {
        const b = zone.bounds;
        self._zoneSummaryEl.textContent =
            `${t("storage.zone.summary")}: ` +
            `N ${b.north.toFixed(3)}, S ${b.south.toFixed(3)}, ` +
            `E ${b.east.toFixed(3)}, W ${b.west.toFixed(3)} · z${zone.cacheMinZoom}–${zone.cacheMaxZoom}`;
    }
    if (self._zoneEstimateEl) {
        const { tiles, bytes } = estimateVectorZone(zone);
        self._zoneEstimateEl.textContent = `${t("storage.zone.estimate")}: ~${formatFileSize(
            bytes
        )} (${tiles} ${t("storage.zone.tiles")})`;
    }
}

// ─── Persistence ─────────────────────────────────────────────────────

async function loadSelection(): Promise<SavedSelection | null> {
    try {
        const profileId = configGet("data.activeProfile", "") as string;
        const Storage = StorageContract.Cache?.Storage;
        if (!profileId || !Storage) return null;
        return (await Storage.loadLayerSelection(profileId)) as SavedSelection | null;
    } catch (error) {
        Log?.error(`[CacheControl] Failed to load selection: ${(error as Error).message}`);
        return null;
    }
}

/** Read-modify-write: stores the zone without clobbering other selection fields. */
async function persistZone(zone: VectorZone): Promise<void> {
    try {
        const profileId = configGet("data.activeProfile", "") as string;
        const Storage = StorageContract.Cache?.Storage as
            | {
                  loadLayerSelection: (id: string) => Promise<SavedSelection | null>;
                  saveLayerSelection: (id: string, s: SavedSelection) => Promise<void>;
              }
            | undefined;
        if (!profileId || !Storage) return;

        const selection = (await Storage.loadLayerSelection(profileId)) || {};
        selection.vectorZone = zone;
        await Storage.saveLayerSelection(profileId, selection);
        Log?.debug(`[CacheControl] Vector zone saved (z${zone.cacheMinZoom}-${zone.cacheMaxZoom})`);
    } catch (error) {
        Log?.error(`[CacheControl] Failed to persist zone: ${(error as Error).message}`);
    }
}

/** Triggers the layer-selector to recompute totals + warnings after a zone change. */
function refreshSelectionTotals(): void {
    const LayerSelector = StorageContract.Cache?.LayerSelector as
        { saveSelection?: () => Promise<void>; updateWarning?: () => Promise<void> } | undefined;
    LayerSelector?.saveSelection?.().catch(() => {
        /* best-effort */
    });
    LayerSelector?.updateWarning?.().catch(() => {
        /* best-effort */
    });
}
