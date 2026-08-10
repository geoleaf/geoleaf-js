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
// API publique S4.4 — module LOCAL : le symbole était élagué du bundle publié du core,
// qui ne l'appelle nulle part. Voir l'en-tête de `sync/vector-zone-estimate.ts`.
import { estimateVectorZone } from "../sync/vector-zone-estimate.js";
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
        | { saveSelection?: () => Promise<void>; updateWarning?: () => Promise<void> }
        | undefined;
    LayerSelector?.saveSelection?.().catch(() => {
        /* best-effort */
    });
    LayerSelector?.updateWarning?.().catch(() => {
        /* best-effort */
    });
}
