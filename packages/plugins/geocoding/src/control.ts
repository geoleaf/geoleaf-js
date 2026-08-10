/*!
 * @geoleaf-plugins/geocoding — DOM Control
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 *
 * Builds, mounts and wires the geocoding search widget (input + results dropdown)
 * into a map container element. Uses the plugin-local {@link createPillSearchInput}
 * helper for the input pill so the look matches the POI search field.
 *
 * Security:
 * - User input goes through `encodeURIComponent` inside providers — never concatenated raw.
 * - Result labels are inserted via `textContent`, never `innerHTML`.
 * - Map drag/zoom events are stopped on the widget wrapper to prevent map interactions
 *   while typing.
 */

import type { IGeocodingProvider } from "./provider.js";
import type { GeocodingConfig, GeocodingResult } from "./types.js";
import { createPillSearchInput } from "./ui/pill-search.js";
import type { PillSearchHandles, PillSearchOptions } from "./ui/pill-search.js";
import { tLabel as t } from "@geoleaf/host-runtime";

/**
 * Handle returned by {@link mountGeocodingControl}.
 * `reveal` toggles the mobile visibility of the pill (formerly handled by the
 * core mobile toolbar's `_handleSearch`); `destroy` unmounts everything.
 */
export interface GeocodingControlHandle {
    /** Removes the widget and all its listeners. */
    destroy: () => void;
    /**
     * Toggles the floating pill on mobile (`gl-geocoding-ctrl--mobile-visible`),
     * optionally syncing a triggering toolbar button's active state, and focuses
     * the input when revealing.
     * @param button - Optional toolbar button that triggered the toggle.
     */
    reveal: (button?: HTMLElement | null) => void;
}

/** Stops event propagation to prevent map pan/zoom while interacting. */
function _stopProp(e: Event): void {
    e.stopPropagation();
}

/**
 * Builds and mounts the geocoding search control into a map container.
 *
 * @param mapContainer - The HTMLElement returned by `adapter.getContainer()`.
 * @param provider     - Active geocoding provider instance.
 * @param config       - Geocoding configuration from profile.
 * @param onSelect     - Callback invoked when the user selects a result.
 * @returns A {@link GeocodingControlHandle} (`destroy` + `reveal`).
 */
export function mountGeocodingControl(
    mapContainer: HTMLElement,
    provider: IGeocodingProvider,
    config: GeocodingConfig,
    onSelect: (result: GeocodingResult) => void
): GeocodingControlHandle {
    const debounceMs = config.debounceMs ?? 300;
    const minChars = config.minChars ?? 3;
    const limit = config.resultLimit ?? 5;
    const placeholder =
        config.placeholder ?? t("geocoding.control.placeholder", "Rechercher une adresse…");
    const position = config.position ?? "top-left";

    // ── DOM construction ──────────────────────────────────────────────────────
    // Outer wrapper: carries positioning classes and event-stop listeners.
    // The pill (.gl-pill-search) and the dropdown (<ul>) are block siblings
    // inside it so the dropdown never distorts the pill’s flex layout.

    const ctrlWrapper = document.createElement("div");
    ctrlWrapper.className = `gl-geocoding-ctrl gl-geocoding-ctrl--${position}`;
    ctrlWrapper.setAttribute("role", "search");

    const pillOptions: PillSearchOptions = {
        placeholder,
        ariaLabel: t("geocoding.control.searchAriaLabel", "Recherche d’adresse"),
        submitAriaLabel: t("geocoding.control.submitAriaLabel", "Lancer la recherche"),
        clearAriaLabel: t("geocoding.control.clearAriaLabel", "Effacer la recherche"),
        inputType: "search",
        onInput: (value) => _onInput(value),
        onSubmit: (value) => _onSubmit(value),
        onClear: () => _clearResults(),
    };
    const pill: PillSearchHandles = createPillSearchInput(pillOptions);

    const { root: pillRoot, input } = pill;
    // ARIA combobox pattern: aria-expanded/-autocomplete/-haspopup/-owns are only
    // valid once the element advertises role="combobox". Without it the implicit
    // searchbox role rejects aria-expanded (WCAG aria-allowed-attr violation).
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-haspopup", "listbox");
    input.setAttribute("aria-owns", "gl-geocoding-results");

    const resultsList = document.createElement("ul");
    resultsList.className = "gl-geocoding-results";
    resultsList.id = "gl-geocoding-results";
    resultsList.setAttribute("role", "listbox");
    resultsList.hidden = true;

    ctrlWrapper.appendChild(pillRoot);
    ctrlWrapper.appendChild(resultsList);
    mapContainer.appendChild(ctrlWrapper);

    // ── Internal state ────────────────────────────────────────────────────────

    let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let _currentResults: GeocodingResult[] = [];

    // ── Private helpers ───────────────────────────────────────────────────────

    function _showResults(results: GeocodingResult[]): void {
        _currentResults = results;
        // Clear previous items — textContent will be used for each new item (no XSS risk)
        resultsList.innerHTML = "";
        resultsList.hidden = results.length === 0;
        input.setAttribute("aria-expanded", results.length > 0 ? "true" : "false");

        results.forEach((result, idx) => {
            const li = document.createElement("li");
            li.className = "gl-geocoding-result-item";
            li.setAttribute("role", "option");
            li.setAttribute("aria-selected", "false");
            li.dataset.idx = String(idx);
            li.textContent = result.label; // safe — textContent, not innerHTML
            resultsList.appendChild(li);
        });
    }

    function _clearResults(): void {
        _currentResults = [];
        resultsList.innerHTML = "";
        resultsList.hidden = true;
        input.setAttribute("aria-expanded", "false");
    }

    async function _doSearch(query: string): Promise<void> {
        ctrlWrapper.classList.add("gl-geocoding-ctrl--loading");
        try {
            const results = await provider.search(query, limit);
            // Discard stale responses if the input changed while fetching
            if (input.value.trim() === query) {
                _showResults(results);
            }
        } finally {
            ctrlWrapper.classList.remove("gl-geocoding-ctrl--loading");
        }
    }

    /** Debounced input handler — triggers a search when minChars is reached. */
    function _onInput(rawValue: string): void {
        const query = rawValue.trim();

        if (_debounceTimer !== null) clearTimeout(_debounceTimer);

        if (query.length < minChars) {
            _clearResults();
            return;
        }
        _debounceTimer = setTimeout(() => void _doSearch(query), debounceMs);
    }

    /** Immediate submit — skips debounce (Enter key or magnifier click). */
    function _onSubmit(rawValue: string): void {
        const query = rawValue.trim();
        if (query.length < minChars) return;
        if (_debounceTimer !== null) {
            clearTimeout(_debounceTimer);
            _debounceTimer = null;
        }
        void _doSearch(query);
    }

    function _onResultClick(e: Event): void {
        const target = (e.target as HTMLElement).closest("[data-idx]");
        if (!target) return;

        const idx = Number((target as HTMLElement).dataset.idx);
        const result = _currentResults[idx];
        if (!result) return;

        input.value = result.label;
        _clearResults();
        onSelect(result);
    }

    function _onListKeyDown(e: KeyboardEvent): void {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            const items = resultsList.querySelectorAll<HTMLElement>(".gl-geocoding-result-item");
            if (items.length === 0) return;
            e.preventDefault();

            const current = resultsList.querySelector<HTMLElement>("[aria-selected='true']");
            let nextIdx = 0;

            if (current) {
                const currentIdx = Number(current.dataset.idx);
                nextIdx =
                    e.key === "ArrowDown"
                        ? Math.min(currentIdx + 1, items.length - 1)
                        : Math.max(currentIdx - 1, 0);
                current.setAttribute("aria-selected", "false");
            } else if (e.key === "ArrowUp") {
                nextIdx = items.length - 1;
            }

            items[nextIdx]?.setAttribute("aria-selected", "true");
            items[nextIdx]?.scrollIntoView?.({ block: "nearest" });
            return;
        }

        if (e.key === "Enter") {
            const selected = resultsList.querySelector<HTMLElement>("[aria-selected='true']");
            if (selected) {
                // Pre-empt the helper's onSubmit when a result is highlighted
                e.preventDefault();
                e.stopPropagation();
                selected.click();
            }
        }
    }

    function _onDocumentClick(e: Event): void {
        if (!ctrlWrapper.contains(e.target as Node)) {
            _clearResults();
        }
    }

    // ── Event listeners ───────────────────────────────────────────────────────

    // Arrow / Enter navigation through the results dropdown — bound at capture
    // phase to run before the pill helper's keydown handler (Enter → submit).
    input.addEventListener("keydown", _onListKeyDown, true);
    resultsList.addEventListener("click", _onResultClick);
    document.addEventListener("click", _onDocumentClick);

    // Prevent map interactions when user is engaging with the geocoding widget
    ctrlWrapper.addEventListener("mousedown", _stopProp);
    ctrlWrapper.addEventListener("touchstart", _stopProp, { passive: true });
    ctrlWrapper.addEventListener("dblclick", _stopProp);
    ctrlWrapper.addEventListener("wheel", _stopProp, { passive: false });

    // ── Reveal (mobile pill toggle) ───────────────────────────────────────────
    // Formerly handled by core mobile-toolbar `_handleSearch`. The plugin now
    // owns the reveal: it toggles the mobile-visible class on the wrapper, keeps
    // the triggering toolbar button's active state in sync, and focuses the input
    // when the pill becomes visible.

    function reveal(button?: HTMLElement | null): void {
        const visibleClass = "gl-geocoding-ctrl--mobile-visible";
        const wasVisible = ctrlWrapper.classList.contains(visibleClass);
        ctrlWrapper.classList.toggle(visibleClass, !wasVisible);
        if (button) {
            button.classList.toggle("gl-map-toolbar__btn--active", !wasVisible);
            button.setAttribute("aria-expanded", String(!wasVisible));
        }
        if (!wasVisible) {
            // Focus the address input when revealing for fast keyboard use
            input.focus();
        }
    }

    // ── Destroy / cleanup ─────────────────────────────────────────────────────

    function destroy(): void {
        if (_debounceTimer !== null) {
            clearTimeout(_debounceTimer);
        }

        input.removeEventListener("keydown", _onListKeyDown, true);
        resultsList.removeEventListener("click", _onResultClick);
        document.removeEventListener("click", _onDocumentClick);
        ctrlWrapper.removeEventListener("mousedown", _stopProp);
        ctrlWrapper.removeEventListener("touchstart", _stopProp);
        ctrlWrapper.removeEventListener("dblclick", _stopProp);
        ctrlWrapper.removeEventListener("wheel", _stopProp);

        pill.destroy();
        ctrlWrapper.remove();
    }

    return { destroy, reveal };
}
