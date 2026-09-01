/*!
 * @geoleaf-plugins/navigation — Manoeuvre wording
 *
 * Turns the normalised `(maneuver, modifier)` pair into one sentence, in the interface
 * language.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { tLabel } from "@geoleaf/host-runtime";
import { cssToken } from "./maneuver-banner.js";

/**
 * ## Why the key is built, and why the fallback is NAMED
 *
 * The vocabulary is small and closed — eight manoeuvres, a handful of modifiers — but it comes
 * from two engines that spell it differently, and only one of them was exercised by the
 * captured corpus. So an unknown pair will happen.
 *
 * 🛑 The fallback says "carry on", and that is a deliberate choice over two worse ones. Showing
 * the raw token (`"fork"`, `"slight left"`) puts an English machine word in a French banner.
 * Showing nothing leaves the driver with a distance counting down towards a blank — which
 * reads as a bug at the exact moment they need to trust the screen. "Carry on" is true of every
 * manoeuvre this could be, and it is the only thing that is.
 *
 * ⚠️ The tokens are normalised before they index the table. An OSRM modifier contains a space —
 * `"slight left"` — and `navigation.maneuver.turn.slight left` resolves to nothing. The user
 * would then read the fallback and believe it, which is worse than an obvious blank: it is a
 * generic sentence one takes for the right one.
 */

/** Manoeuvres whose wording depends on which way you go. */
const DIRECTIONAL = new Set(["turn", "fork"]);

/**
 * The sentence for one manoeuvre.
 *
 * @param maneuver The normalised manoeuvre, e.g. `"turn"`.
 * @param modifier The normalised modifier, e.g. `"left"`, when the manoeuvre has one.
 * @returns The sentence, in the active interface language.
 */
export function maneuverLabel(maneuver: string, modifier: string | undefined): string {
    const m = cssToken(maneuver);
    const d = cssToken(modifier);
    const key =
        DIRECTIONAL.has(m) && d !== "unknown"
            ? `navigation.maneuver.${m}.${d}`
            : `navigation.maneuver.${m}`;

    const label = tLabel(key, "");
    // ⚠️ Compared against the key itself as well as against empty: `tLabel` answers with the
    // key on some hosts when nothing matches, and a banner reading
    // `navigation.maneuver.fork.sharp-left` is the most alarming possible way to say "unknown".
    return label && label !== key ? label : tLabel("navigation.maneuver.unknown", "");
}

/**
 * A distance a driver reads at a glance.
 *
 * ⚠️ Rounded coarsely on purpose, and by band. "437 m" changes every second and asks the reader
 * to parse three digits while driving; "450 m" then "400 m" says the same thing and can be read
 * without looking twice. Below 100 m the band tightens, because that is where the number stops
 * being an estimate and starts being a cue to act.
 *
 * @param metres The distance.
 * @param unitMetres Label for metres, resolved by the caller.
 * @param unitKilometres Label for kilometres, resolved by the caller.
 * @returns The text.
 */
export function formatApproachDistance(
    metres: number,
    unitMetres: string,
    unitKilometres: string
): string {
    if (!Number.isFinite(metres) || metres < 0) return "";
    if (metres >= 1000)
        return `${(Math.round(metres / 100) / 10).toLocaleString()} ${unitKilometres}`;
    if (metres >= 100) return `${Math.round(metres / 50) * 50} ${unitMetres}`;
    return `${Math.round(metres / 10) * 10} ${unitMetres}`;
}
