/*!
 * GeoLeaf Core (feature-info capability) — The visual weight of an action button
 * © 2026 Mattieu Pottier — MIT License
 *
 * Reads the `variant` an `action` field declares and dresses the button with it. Kept
 * out of `./widget-dispatch.js` because the button's identity, confirmation and payload
 * live there, and its LOOK is a separate question with its own warning.
 * https://geoleaf.dev
 */

import type { ActionVariant } from "../../../contracts/attributes.contract.js";

/**
 * The weights the engine dresses — the contract's `ActionVariant`, mapped to the modifier
 * each one sets.
 *
 * ⚠️ A `Record` keyed by the union rather than a hand-written array: TypeScript refuses a
 * missing member and an extra one alike, so this table cannot drift from the type. The
 * schema's `attributeOptions.variant` enum is confronted with it by rendering every value
 * the schema allows (`popup-action-variant.test.ts`).
 *
 * ⚠️ The class names are written out, never assembled from a template. `verify-purgecss`
 * finds a rule's emitter by scanning the sources for the literal name: built as
 * `--${variant}`, the three modifiers and their hover states read as dead CSS — measured on
 * the first run. Spelled here, the emitter is also what a `grep` for the class finds.
 */
const ACTION_VARIANTS: Readonly<Record<ActionVariant, string>> = {
    primary: "gl-poi-popup__action--primary",
    secondary: "gl-poi-popup__action--secondary",
    danger: "gl-poi-popup__action--danger",
};

/** Variants already reported, so a per-feature render loop warns once, not per click. */
const warnedVariants = new Set<string>();

/**
 * Narrows a declared value to a variant the engine dresses.
 *
 * `Object.hasOwn` rather than `in`: the value comes from a profile, and `"constructor"`
 * is `in` every object literal.
 *
 * @param value - The declared value.
 * @returns `true` when a modifier exists for it.
 */
function isActionVariant(value: string): value is ActionVariant {
    return Object.hasOwn(ACTION_VARIANTS, value);
}

/**
 * Warns once per undressed variant, through the logging seam when present.
 *
 * @param variant - The declared value no modifier claims.
 * @param actionId - The action that declared it.
 * @param layerId - The layer that declared it, when known.
 */
function warnUnknownVariant(variant: string, actionId: string, layerId?: string): void {
    const key = `${layerId ?? "?"}|${actionId}|${variant}`;
    if (warnedVariants.has(key)) return;
    warnedVariants.add(key);
    const message =
        `[feature-info] variante d'action inconnue "${variant}" sur l'action "${actionId}"` +
        (layerId ? ` de la couche "${layerId}"` : "") +
        ` — le bouton garde son style par défaut. Valeurs reconnues : ${Object.keys(ACTION_VARIANTS).join(", ")}.`;
    const seam = (globalThis as { GeoLeaf?: { Log?: { warn?(m: string): void } } }).GeoLeaf?.Log;
    if (typeof seam?.warn === "function") seam.warn(message);
    else console.warn(message);
}

/**
 * Dresses an action button with the visual weight its field declares.
 *
 * A known variant sets the `gl-poi-popup__action--<variant>` modifier — what the
 * stylesheet hooks — and `data-gl-variant`, what a host can select without depending on a
 * class name. No variant leaves the button untouched: the base class alone already is the
 * filled look `primary` spells out. An unknown value leaves it untouched too, and warns
 * once — a modifier no stylesheet matches would be exactly the silence this closes.
 *
 * @param btn - The action button, already carrying its base class.
 * @param variant - The field's declared `variant`, as authored.
 * @param actionId - The action's identifier, named in the warning.
 * @param layerId - The layer that declared it, when known.
 */
export function applyActionVariant(
    btn: HTMLElement,
    variant: unknown,
    actionId: string,
    layerId?: string
): void {
    if (variant === undefined || variant === null || variant === "") return;
    if (typeof variant === "string" && isActionVariant(variant)) {
        btn.classList.add(ACTION_VARIANTS[variant]);
        btn.dataset["glVariant"] = variant;
        return;
    }
    warnUnknownVariant(String(variant), actionId, layerId);
}
