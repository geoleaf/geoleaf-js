/*!
 * @geoleaf-plugins/isochrone — Config reader
 *
 * Reads `modules.isochrone`, the plugin's ONLY branch of the profile, merges it over the
 * built-in defaults and VALIDATES it: a value the plugin cannot use falls back to its default
 * rather than travelling further.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { coreConfigGet } from "@geoleaf/host-runtime";
import type { TravelMode } from "./model.js";

/** The three modes, as a set, so an unknown token is discarded rather than forwarded. */
const TRAVEL_MODES: readonly TravelMode[] = ["car", "foot", "bike"];

/** A colour the plugin accepts: `#rrggbb`, and nothing else. */
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

/**
 * The highest `maxLayers` a profile may set.
 *
 * ⚠️ It is not a taste: the stack spaces its zones by `1 / (MAX_LAYER_CAP + 1)` above
 * `zIndex`, and a larger cap would push the top zone to `zIndex + 1` or beyond — into the rank
 * of the profile's next layers.
 */
export const MAX_LAYER_CAP = 99;

const DEFAULTS = {
    enabled: true,

    // Read by the toolbar slot of `entry.ts` as `modules.isochrone.showButton` — the SAME
    // branch this file reads (INV-CONFIG).
    showButton: true,

    // Which routing engine to ask. An unknown name is REFUSED at the moment a provider is
    // built, never replaced by another engine — see `createProvider` in `provider.ts`.
    provider: "valhalla",

    // Empty means "use the default address of the selected provider". A value that does not
    // start with `https://` is refused, never corrected. ⚠️ A profile is a served file: no key
    // is ever written here — it is given at runtime, through `configure()`.
    endpoint: "",

    // How long the engine is given to answer, in milliseconds, per request.
    timeoutMs: 10000,

    // The mode offered when the window opens.
    mode: "car",

    // The modes offered.
    modes: ["car", "foot", "bike"],

    // The durations offered, in minutes.
    durations: [5, 10, 15],

    // Cap on the number of zones displayed — at most MAX_LAYER_CAP.
    maxLayers: 8,

    // Base of the stack: the zones live strictly between `zIndex` and `zIndex + 1`.
    zIndex: 50,

    // A zone takes the first colour no other zone carries, and keeps it.
    palette: [
        "#3987e5",
        "#d95926",
        "#199e70",
        "#c98500",
        "#d55181",
        "#008300",
        "#9085e9",
        "#e66767",
    ],

    // Initial opacity of a zone's fill, from 0 to 1.
    fillOpacity: 0.25,
} as const;

/**
 * The plugin's configuration, as read from `modules.isochrone` in the active profile.
 *
 * ⚠️ This interface is the ORACLE of the plugin's README: `check-plugin-readme-config.cjs`
 * requires every member here to be documented there.
 *
 * The index signature is deliberate: a profile may carry keys this version does not know yet,
 * and dropping them at the type boundary would make an unknown key indistinguishable from a
 * typo.
 */
export interface PluginConfig {
    /** `false`: `open()` answers `false`. The button follows `showButton` alone. */
    enabled: boolean;
    /** Shows the toolbar button. `false` hides it; the API stays usable. */
    showButton: boolean;
    /** Routing engine id, matched against the registered providers. Unknown: refused. */
    provider: string;
    /** Base URL of the engine. Empty selects the provider's default; non-HTTPS is refused. */
    endpoint: string;
    /** Milliseconds the engine is given per request. Zero or negative falls back. */
    timeoutMs: number;
    /** Mode offered when the window opens — one of `modes`. */
    mode: TravelMode;
    /** Modes offered. An unknown name is discarded. */
    modes: readonly TravelMode[];
    /** Durations offered, in whole positive minutes, ascending. */
    durations: readonly number[];
    /** Cap on the number of zones displayed: a whole number from 1 to 99. */
    maxLayers: number;
    /** Base rank of the stack of zones. */
    zIndex: number;
    /** Colours given to the zones, `#rrggbb`. */
    palette: readonly string[];
    /** Initial opacity of a zone's fill, from 0 to 1. */
    fillOpacity: number;

    [key: string]: unknown;
}

/**
 * Keeps a boolean, or falls back.
 *
 * @param value What the profile carries.
 * @param fallback The default.
 * @returns `value` when it is a boolean.
 */
function bool(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

/**
 * Keeps a finite number accepted by `accept`, or falls back.
 *
 * @param value What the profile carries.
 * @param fallback The default.
 * @param accept The rule the number must satisfy.
 * @returns `value` when it is usable.
 */
function num(value: unknown, fallback: number, accept: (n: number) => boolean): number {
    return typeof value === "number" && Number.isFinite(value) && accept(value) ? value : fallback;
}

/**
 * Keeps the usable entries of a list, without duplicates, or falls back when none is left.
 *
 * @param value What the profile carries.
 * @param fallback The default list.
 * @param accept Tells a usable entry.
 * @returns The usable entries in their original order, or `fallback`.
 */
function list<T>(value: unknown, fallback: readonly T[], accept: (v: unknown) => v is T): T[] {
    const kept = Array.isArray(value) ? [...new Set(value.filter(accept))] : [];
    return kept.length > 0 ? kept : [...fallback];
}

/**
 * Tells a travel mode this package knows.
 *
 * @param v Any value.
 * @returns Whether it is one of the three modes.
 */
export function isTravelMode(v: unknown): v is TravelMode {
    return typeof v === "string" && (TRAVEL_MODES as readonly string[]).includes(v);
}

/**
 * Tells a duration the plugin can offer: a whole, positive number of minutes.
 *
 * @param v Any value.
 * @returns Whether it is usable.
 */
export function isDuration(v: unknown): v is number {
    return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/**
 * Tells a cap on the zones the stack can rank: a whole number from 1 to `MAX_LAYER_CAP`.
 *
 * @param n A finite number.
 * @returns Whether it is usable.
 */
function isLayerCap(n: number): boolean {
    return Number.isInteger(n) && n >= 1 && n <= MAX_LAYER_CAP;
}

/**
 * Tells a colour written `#rrggbb` — what the profile's palette and a restyled zone accept.
 *
 * @param v Any value.
 * @returns Whether it is usable.
 */
export function isColour(v: unknown): v is string {
    return typeof v === "string" && HEX_COLOUR.test(v);
}

/**
 * Reads the plugin configuration from the `modules.isochrone` namespace of the running core
 * (Plugin Contract v1, INV-CONFIG), merged over the built-in defaults and validated.
 *
 * ⚠️ `modules.isochrone` is the plugin's ONLY branch of the profile — never open a second
 * one, whatever the key. See `PLUGIN_ARCHITECTURE_SPEC.md` §5.
 *
 * Every key falls back on its own: a mistyped `fillOpacity` does not cost the profile its
 * `durations`. Two keys are deliberately NOT judged here — `provider`, whose unknown names are
 * refused where a provider is built, and `endpoint`, refused where it is resolved: both
 * refusals must stay visible, and a fallback here would hide them behind a computation that
 * works.
 *
 * @returns The merged configuration — built-in defaults under any usable profile override.
 */
export function getPluginConfig(): PluginConfig {
    const raw = coreConfigGet<Partial<PluginConfig>>("modules.isochrone", {}) ?? {};
    const modes = list<TravelMode>(raw.modes, DEFAULTS.modes, isTravelMode);
    const preferred = isTravelMode(raw.mode) ? raw.mode : DEFAULTS.mode;
    return {
        ...raw,
        enabled: bool(raw.enabled, DEFAULTS.enabled),
        showButton: bool(raw.showButton, DEFAULTS.showButton),
        provider:
            typeof raw.provider === "string" && raw.provider !== ""
                ? raw.provider
                : DEFAULTS.provider,
        endpoint: typeof raw.endpoint === "string" ? raw.endpoint : DEFAULTS.endpoint,
        timeoutMs: num(raw.timeoutMs, DEFAULTS.timeoutMs, (n) => n > 0),
        // A mode that is not among the modes offered cannot be the one offered first.
        mode: modes.includes(preferred) ? preferred : (modes[0] ?? DEFAULTS.mode),
        modes,
        durations: list<number>(raw.durations, DEFAULTS.durations, isDuration).sort(
            (a, b) => a - b
        ),
        maxLayers: num(raw.maxLayers, DEFAULTS.maxLayers, isLayerCap),
        zIndex: num(raw.zIndex, DEFAULTS.zIndex, () => true),
        palette: list<string>(raw.palette, DEFAULTS.palette, isColour),
        fillOpacity: num(raw.fillOpacity, DEFAULTS.fillOpacity, (n) => n >= 0 && n <= 1),
    };
}
