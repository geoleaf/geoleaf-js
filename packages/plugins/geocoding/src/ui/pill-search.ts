/*!
 * @geoleaf-plugins/geocoding — Pill-shaped search input (self-contained)
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 *
 * Lightweight, self-contained copy of the core `.gl-pill-search` helper used by
 * the geocoding control. The plugin must not import the core implementation
 * (INV-NS), so the SVG icons are built with a local `_createIcon` helper based
 * on `document.createElementNS` — no `innerHTML` (INV-SEC).
 *
 * SEAM: this is the deliberate copy of `packages/core/src/kernel/ui/
 * pill-search.ts`. The `_createIcon` divergence is expected (it re-implements the
 * core's `DOMSecurity.createSVGIcon` locally). The pair is registered in
 * `scripts/verify-seam-drift.cjs`; editing this file trips that gate until the core
 * copy is re-read and both hashes are re-pinned.
 *
 * Security:
 *  - SVG icons are built via `createElementNS`; no innerHTML.
 *  - The helper never inserts user-provided strings — callers render their own
 *    results with `textContent` only.
 */

/** Options accepted by {@link createPillSearchInput}. */
export interface PillSearchOptions {
    /** Placeholder text for the input. */
    placeholder: string;
    /** ARIA label applied to the root `[role=search]` wrapper. */
    ariaLabel: string;
    /** ARIA label of the input itself. Defaults to `placeholder`. */
    inputAriaLabel?: string;
    /** ARIA label of the submit (magnifier) button. */
    submitAriaLabel: string;
    /** ARIA label of the clear (×) button. */
    clearAriaLabel: string;
    /** Optional extra class names applied on the root wrapper. */
    extraClass?: string;
    /** Optional input `type` (default `"text"`; geocoding may use `"search"`). */
    inputType?: "text" | "search";
    /** Called whenever the input value changes. */
    onInput?: (value: string) => void;
    /**
     * Called when the user submits (clicks submit button or presses Enter).
     * The current input value is passed as argument.
     */
    onSubmit?: (value: string) => void;
    /**
     * Called when the user clears the input (clicks × or presses Escape on
     * a non-empty input). The implementation already empties the value before
     * invoking the callback.
     */
    onClear?: () => void;
}

/** DOM handles returned by {@link createPillSearchInput}. */
export interface PillSearchHandles {
    /** Root `<div class="gl-pill-search">` wrapper. */
    root: HTMLDivElement;
    /** The search input element. */
    input: HTMLInputElement;
    /** The trailing × button (auto-hidden when the input is empty). */
    clearBtn: HTMLButtonElement;
    /** The trailing magnifier button (always visible). */
    submitBtn: HTMLButtonElement;
    /**
     * Removes all listeners and detaches the wrapper from its parent.
     * Idempotent — safe to call multiple times.
     */
    destroy: () => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const MAGNIFIER_PATH = "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z";
const CLOSE_PATH = "M18 6L6 18M6 6l12 12";

/**
 * Builds a stroked SVG icon (single path) without any `innerHTML`.
 * Local equivalent of the core `DOMSecurity.createSVGIcon` (INV-SEC / INV-NS).
 */
function _createIcon(pathData: string, size: number): SVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", pathData);
    svg.appendChild(path);

    return svg;
}

/** DOM elements that make up a pill search input (before behaviour wiring). */
interface PillSearchDom {
    root: HTMLDivElement;
    input: HTMLInputElement;
    clearBtn: HTMLButtonElement;
    submitBtn: HTMLButtonElement;
}

/** Builds the static DOM (wrapper, input, clear and submit buttons). */
function _buildPillDom(opts: PillSearchOptions): PillSearchDom {
    const root = document.createElement("div");
    root.className = opts.extraClass ? `gl-pill-search ${opts.extraClass}` : "gl-pill-search";
    root.setAttribute("role", "search");
    root.setAttribute("aria-label", opts.ariaLabel);

    const input = document.createElement("input");
    input.type = opts.inputType ?? "text";
    input.className = "gl-pill-search__input";
    input.placeholder = opts.placeholder;
    input.setAttribute("aria-label", opts.inputAriaLabel ?? opts.placeholder);
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("spellcheck", "false");

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "gl-pill-search__clear";
    clearBtn.setAttribute("aria-label", opts.clearAriaLabel);
    clearBtn.hidden = true;
    clearBtn.appendChild(_createIcon(CLOSE_PATH, 16));

    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "gl-pill-search__submit";
    submitBtn.setAttribute("aria-label", opts.submitAriaLabel);
    submitBtn.appendChild(_createIcon(MAGNIFIER_PATH, 18));

    root.appendChild(input);
    root.appendChild(clearBtn);
    root.appendChild(submitBtn);

    return { root, input, clearBtn, submitBtn };
}

/**
 * Builds the pill-shaped search input. The wrapper carries the
 * `.gl-pill-search` class — callers add their own positioning classes
 * via {@link PillSearchOptions.extraClass}.
 */
export function createPillSearchInput(opts: PillSearchOptions): PillSearchHandles {
    const { root, input, clearBtn, submitBtn } = _buildPillDom(opts);

    // ── Behaviour ─────────────────────────────────────────────────────────────

    function _toggleClearVisibility(): void {
        clearBtn.hidden = input.value.length === 0;
    }

    function _handleInput(): void {
        _toggleClearVisibility();
        opts.onInput?.(input.value);
    }

    function _handleSubmit(): void {
        _toggleClearVisibility();
        opts.onSubmit?.(input.value);
    }

    function _handleClear(): void {
        input.value = "";
        _toggleClearVisibility();
        opts.onClear?.();
        input.focus();
    }

    function _handleKeydown(e: KeyboardEvent): void {
        if (e.key === "Enter") {
            e.preventDefault();
            _handleSubmit();
            return;
        }
        if (e.key === "Escape") {
            if (input.value.length > 0) {
                _handleClear();
            } else {
                input.blur();
            }
        }
    }

    input.addEventListener("input", _handleInput);
    input.addEventListener("keydown", _handleKeydown);
    submitBtn.addEventListener("click", _handleSubmit);
    clearBtn.addEventListener("click", _handleClear);

    let _destroyed = false;
    function destroy(): void {
        if (_destroyed) return;
        _destroyed = true;
        input.removeEventListener("input", _handleInput);
        input.removeEventListener("keydown", _handleKeydown);
        submitBtn.removeEventListener("click", _handleSubmit);
        clearBtn.removeEventListener("click", _handleClear);
        root.remove();
    }

    return { root, input, clearBtn, submitBtn, destroy };
}
