/*!
 * @geoleaf-plugins/measure — Unit button cycle and labels
 * © 2026 Mattieu Pottier — MIT License
 *
 * What the two unit buttons of the floating menu cycle through, what they show, and what
 * they are called for assistive technology. Pure functions: the menu keeps the state.
 * https://geoleaf.dev
 */
import { _getLabel } from "./internal.js";
import type { AreaUnit, DistanceUnit } from "./types.js";

/** The quantity a unit button drives: `"dist"` for lengths, `"area"` for surfaces. */
export type UnitButtonType = "dist" | "area";

// `auto` FIRST and reachable: it chooses the readable unit for the magnitude, and the button could
// not come back to it once left.
const _DIST_CYCLE: DistanceUnit[] = ["auto", "m", "km"];
const _AREA_CYCLE: AreaUnit[] = ["auto", "m2", "ha", "km2"];

// `auto` keeps the quantity's base symbol next to the tilde: a bare "~" made the two buttons,
// stacked one above the other, impossible to tell apart.
const _TEXT: Record<string, string> = {
    m: "m",
    km: "km",
    m2: "m²",
    ha: "ha",
    km2: "km²",
};

/** Returns the unit that follows `current` in the button's cycle (wrapping to `auto`). */
export function nextUnit(type: "dist", current: DistanceUnit): DistanceUnit;
export function nextUnit(type: "area", current: AreaUnit): AreaUnit;
export function nextUnit(type: UnitButtonType, current: string): string {
    const cycle: string[] = type === "dist" ? _DIST_CYCLE : _AREA_CYCLE;
    const idx = cycle.indexOf(current);
    // The modulo keeps the index in range, so the default never fires — it states that
    // invariant rather than asserting it.
    return cycle[(idx < 0 ? 0 : idx + 1) % cycle.length] ?? "auto";
}

/** Visible text of a unit button: the unit symbol, or `~ m` / `~ m²` in automatic mode. */
export function unitButtonText(type: UnitButtonType, unit: string): string {
    if (unit === "auto") return type === "dist" ? "~ m" : "~ m²";
    return _TEXT[unit] ?? unit;
}

/**
 * Accessible name (and tooltip) of a unit button: the quantity and the CURRENT unit, in the
 * active language — e.g. "Unité des distances : km", "Area unit: automatic".
 */
export function unitButtonName(type: UnitButtonType, unit: string): string {
    const template = _getLabel(
        type === "dist" ? "measure.unit.distance.current" : "measure.unit.area.current"
    );
    const unitName =
        unit === "auto"
            ? _getLabel("measure.unit.auto")
            : _getLabel(`measure.unit.${unit}`, _TEXT[unit] ?? unit);
    return template.replace("{unit}", unitName);
}
