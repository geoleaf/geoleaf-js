/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI – Mobile toolbar: proximity configuration bar.
 */

import { Config as _Config } from "../../config/geoleaf-config/config-core.js";

import { domState, _g } from "./mobile-toolbar-state.js";

import { createSvgIcon, refreshFilterButtonState } from "./mobile-toolbar-pill.js";
import { getLabel } from "../../../utils/i18n/i18n.js";

// ── Local structural types ──────────────────────────────────────────────

/** One `modules.filter` field descriptor whose radius bounds are read dynamically. */
type FilterFieldLike = Record<string, unknown>;

/** Subset of the active profile read for proximity radius bounds (`modules.filter.fields`). */
interface ActiveProfileLike {
    modules?: { filter?: { fields?: FilterFieldLike[] } };
}

// `Config` (ConfigInstance) is augmented at runtime with `getActiveProfile()`,
// which is not on the static interface. Narrow to the member read here.
interface ConfigLike {
    getActiveProfile?(): ActiveProfileLike | null | undefined;
}

/** Subset of `GeoLeaf.Filter` consumed by the proximity bar (S13). */
interface FilterLike {
    applyNow?: () => void;
    proximity?: {
        setRadius?: (radiusKm: number) => void;
        toggle?: (
            map: unknown,
            radiusKm?: number,
            options?: { onPointPlaced?: () => void }
        ) => boolean;
    };
}

const Config = _Config as ConfigLike;

/** In-core fallback radius, in km, when the profile declares no proximity bounds. */
const DEFAULT_RADIUS_KM = 10;

/**
 * The bar's default radius, in km, read back from the slider that carries it.
 *
 * Single reader for that default: the label, the toolbar button and the deactivation
 * path all resolve it here, so they can no longer disagree. Parsed as a float — the
 * profile is free to declare a fractional `radiusDefault`, and truncating it silently
 * moved the painted circle away from the value shown next to it.
 *
 * @returns The slider default when it is a usable radius, else {@link DEFAULT_RADIUS_KM}.
 */
export function proximityDefaultRadiusKm(): number {
    const km = Number.parseFloat(domState.proximitySlider?.defaultValue ?? "");
    return Number.isFinite(km) && km > 0 ? km : DEFAULT_RADIUS_KM;
}

/** Renders a radius, in km, through the dictionary rather than an inline template. */
function _formatRadiusLabel(km: number): string {
    return getLabel("format.proximity.radius", String(km));
}

function _applyRadiusConfig(
    field: FilterFieldLike,
    out: { min: number; max: number; step: number; def: number }
): void {
    const props: Array<[keyof typeof out, string]> = [
        ["min", "radiusMin"],
        ["max", "radiusMax"],
        ["step", "radiusStep"],
        ["def", "radiusDefault"],
    ];
    for (const [k, prop] of props) {
        if (typeof field[prop] === "number" && field[prop] > 0) out[k] = field[prop];
    }
    out.def = Math.max(out.min, Math.min(out.def, out.max));
}

function _readProximityRadius(): { min: number; max: number; step: number; def: number } {
    const out = { min: 1, max: 50, step: 1, def: DEFAULT_RADIUS_KM };
    try {
        // Radius bounds live on the `proximity` field of `modules.filter` (migrated
        // from the legacy `searchConfig.radius*` in S5/F5).
        const fields = Config.getActiveProfile?.()?.modules?.filter?.fields;
        if (Array.isArray(fields)) {
            const proximity = fields.find((f) => f.kind === "proximity");
            if (proximity) _applyRadiusConfig(proximity, out);
        }
    } catch (_e) {
        /* fallback to defaults */
    }
    return out;
}

function _runFilterApplier(): void {
    const filter = _g.GeoLeaf?.Filter as FilterLike | undefined;
    filter?.applyNow?.();
}

function _createProximitySlider(
    min: number,
    max: number,
    step: number,
    def: number
): HTMLInputElement {
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "gl-proximity-bar__slider";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.defaultValue = String(def);
    slider.setAttribute("aria-label", getLabel("aria.proximity.slider"));
    domState.proximitySlider = slider;
    return slider;
}

/** Creates the proximity configuration pill (slider + validate/cancel). */

export function createProximityBarDom(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "gl-proximity-bar";
    bar.style.display = "none";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", getLabel("aria.proximity.region"));
    const instruction = document.createElement("span");
    instruction.className = "gl-proximity-bar__instruction";
    instruction.textContent = getLabel("ui.proximity.instruction_initial");
    domState.proximityInstruction = instruction;
    bar.appendChild(instruction);
    const {
        min: _minRadius,
        max: _maxRadius,
        step: _stepRadius,
        def: _defaultRadius,
    } = _readProximityRadius();
    const slider = _createProximitySlider(_minRadius, _maxRadius, _stepRadius, _defaultRadius);
    bar.appendChild(slider);
    const radiusLabel = document.createElement("span");
    radiusLabel.className = "gl-proximity-bar__radius-label";
    radiusLabel.textContent = _formatRadiusLabel(_defaultRadius);
    domState.proximityRadiusLabel = radiusLabel;
    bar.appendChild(radiusLabel);
    const validateBtn = document.createElement("button");
    validateBtn.type = "button";
    validateBtn.className = "gl-proximity-bar__validate";
    validateBtn.setAttribute("aria-label", getLabel("aria.proximity.validate"));
    validateBtn.disabled = true;
    validateBtn.appendChild(createSvgIcon("M9 10l-4 4 4 4M5 14h8a4 4 0 000-8H9", 20));
    validateBtn.addEventListener("click", () => closeProximityBar(false));
    domState.proximityValidateBtn = validateBtn;
    bar.appendChild(validateBtn);
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "gl-proximity-bar__cancel";
    cancelBtn.setAttribute("aria-label", getLabel("aria.proximity.cancel"));
    cancelBtn.appendChild(createSvgIcon("M18 6L6 18M6 6l12 12", 18));
    cancelBtn.addEventListener("click", () => closeProximityBar(true));
    bar.appendChild(cancelBtn);
    slider.addEventListener("input", () => {
        // parseFloat, not parseInt: a profile may declare a fractional `radiusStep`, and
        // truncating here collapsed every sub-kilometre notch onto a zero-radius circle.
        // No NaN guard: a range input coerces its value, so this always parses.
        const km = Number.parseFloat(slider.value);
        if (domState.proximityRadiusLabel)
            domState.proximityRadiusLabel.textContent = _formatRadiusLabel(km);
        const filter = _g.GeoLeaf?.Filter as FilterLike | undefined;
        filter?.proximity?.setRadius?.(km);
    });
    domState.proximityBar = bar;
    return bar;
}

/** Shows the proximity pill with fade+scale animation. */

export function openProximityBar(): void {
    if (!domState.proximityBar) return;
    if (domState.proximityValidateBtn) domState.proximityValidateBtn.disabled = true;
    if (domState.proximityInstruction) {
        domState.proximityInstruction.textContent = getLabel("ui.proximity.instruction_initial");
        domState.proximityInstruction.classList.remove("point-placed");
    }
    if (domState.proximitySlider)
        domState.proximitySlider.value = domState.proximitySlider.defaultValue;
    if (domState.proximityRadiusLabel)
        domState.proximityRadiusLabel.textContent = _formatRadiusLabel(proximityDefaultRadiusKm());
    domState.proximityBar.style.display = "flex";
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (domState.proximityBar) domState.proximityBar.classList.add("gl-is-visible");
            const glMain = domState.options?.glMain;
            if (glMain) {
                glMain.style.setProperty("--gl-proximity-bar-height", "46px");
                glMain.style.setProperty("--gl-proximity-bar-gap", "0.4rem");
            }
        });
    });
}

/**
 * Closes the proximity pill.
 * @param cancel true = cancel (deactivates mode), false = validate (keeps mode active).
 * @param skipFilter Close the bar without re-running the filter — used when the caller is
 *   about to run it itself, so the map is not filtered twice.
 */

export function closeProximityBar(cancel: boolean, skipFilter = false): void {
    if (!domState.proximityBar) return;
    domState.proximityBar.classList.remove("gl-is-visible");
    const glMain = domState.options?.glMain;
    if (glMain) {
        glMain.style.removeProperty("--gl-proximity-bar-height");
        glMain.style.removeProperty("--gl-proximity-bar-gap");
    }
    domState.proximityBar.addEventListener(
        "transitionend",
        () => {
            if (
                domState.proximityBar &&
                !domState.proximityBar.classList.contains("gl-is-visible")
            ) {
                domState.proximityBar.style.display = "";
            }
        },
        { once: true }
    );
    if (cancel) {
        const filter = _g.GeoLeaf?.Filter as FilterLike | undefined;
        const map = domState.options?.map;
        if (filter?.proximity?.toggle && map && domState.proximityActive) {
            filter.proximity.toggle(map, proximityDefaultRadiusKm());
        }
        domState.proximityActive = false;
        const proximityBtn = domState.toolbar?.querySelector('[data-gl-sheet="proximity"]');
        if (proximityBtn instanceof HTMLElement)
            proximityBtn.classList.remove("gl-map-toolbar__btn--active");
        if (!skipFilter) _runFilterApplier();
        refreshFilterButtonState();
    } else {
        if (!skipFilter) _runFilterApplier();
        refreshFilterButtonState();
    }
}
