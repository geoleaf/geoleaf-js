/*!
 * @geoleaf-plugins/navigation — Spoken guidance
 *
 * Decides WHEN a manoeuvre is worth saying out loud, and says it once.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { tLabel, getActiveLang } from "@geoleaf/host-runtime";
import type { RouteStep } from "@geoleaf-plugins/routing";
import { createVoiceAnnouncer, type VoiceAnnouncer } from "../platform/voice.js";
import { maneuverLabel, formatApproachDistance } from "./maneuver-labels.js";

/**
 * ## Why the POLICY is here and the platform is not
 *
 * `platform/voice.ts` knows how to speak and how to shut up. It does not know what a manoeuvre
 * is, when one becomes worth announcing, or that saying the same thing twice is a defect. That
 * split is the same one the whole package is built on: a native port replaces `platform/`, and
 * everything in this file survives it unchanged.
 *
 * ## 🛑 Why the step's IDENTITY is its object reference
 *
 * A manoeuvre must be announced exactly once. The obvious key is the step index — and it is
 * wrong in the one case that matters: after a recomputation, index 0 is a **different** step on
 * a **different** route, and keying on the number would leave the first manoeuvre of the new
 * route silent. The engine hands the view `ahead.step`, which is the `RouteStep` object taken
 * straight out of the leg, so the reference is stable while the route is and changes the moment
 * it is replaced. Both halves of the rule fall out of that for free.
 *
 * ## Why nothing is said until the driver is close
 *
 * `voiceAnnounceAtMetres` is the whole trigger. A manoeuvre announced the instant it becomes
 * "next" would be announced kilometres early, and by the time it mattered the driver would have
 * forgotten it. A step SHORTER than the threshold is already inside it when it becomes next, so
 * it is announced immediately — which is the right behaviour, not an edge case.
 *
 * ## Why the announcement carries no road name
 *
 * The banner shows it, as data, on its own line. Speaking it would need a second sentence
 * pattern per language ("turn left ONTO x" does not compose with every manoeuvre in the closed
 * vocabulary), for a gain the distance and the manoeuvre already deliver. The threshold this
 * module is configured by is named for the manoeuvre, and that is what it says.
 */

/** How the announcer behaves. */
export interface AnnouncerOptions {
    /** Whether announcements start switched on. Switchable afterwards, per session. */
    readonly enabled: boolean;
    /** How far ahead of a manoeuvre it is announced, in METRES. */
    readonly announceAtMetres: number;
}

/** Spoken guidance, for as long as a session lasts. */
export interface Announcer {
    /** Whether the platform can speak at all — an interface should hide a dead toggle. */
    readonly available: boolean;
    /** Whether announcements are currently allowed. */
    readonly enabled: boolean;
    /** Turns announcements on or off. Turning off silences what is already speaking. */
    setEnabled(on: boolean): void;
    /**
     * Considers a sample, and speaks if this manoeuvre is newly within range.
     *
     * @param step The manoeuvre ahead, or `null` when there is none.
     * @param distanceMetres How far it is.
     */
    update(step: RouteStep | null, distanceMetres: number): void;
    /** Stops mid-sentence and forgets what was said. Idempotent. */
    destroy(): void;
}

/**
 * Creates the spoken half of a guidance session.
 *
 * @param options Starting state and the announcement distance, both resolved from the profile
 *                by `config.ts` — this module defaults neither.
 * @returns The announcer. Every method is safe on a platform with no speech: `available` says
 *          so and each call is a no-op.
 */
export function createAnnouncer(options: AnnouncerOptions): Announcer {
    const voice: VoiceAnnouncer = createVoiceAnnouncer(getActiveLang());
    voice.setEnabled(options.enabled);

    /** The step already spoken, by reference. See the note above on why not an index. */
    let announced: RouteStep | null = null;

    /**
     * Builds the sentence.
     *
     * ⚠️ Spoken units, never the banner's. A synthesiser reads `m` as the letter, so "in two
     * hundred m" is not a sentence — the two outputs need two sets of labels, and that is not
     * duplication.
     *
     * @param step The manoeuvre to announce.
     * @param metres How far it is.
     * @returns The sentence, in the interface language.
     */
    function sentence(step: RouteStep, metres: number): string {
        const distance = formatApproachDistance(
            metres,
            tLabel("navigation.voice.unit.metres", "m"),
            tLabel("navigation.voice.unit.kilometres", "km")
        );
        const move = maneuverLabel(step.maneuver, step.modifier);
        // `{0}` / `{1}` is the core's own interpolation convention. Substituted here because the
        // host seam resolves a key and does not take arguments.
        return tLabel("navigation.voice.ahead", "{0}, {1}")
            .replace("{0}", distance)
            .replace("{1}", move);
    }

    return {
        get available(): boolean {
            return voice.available;
        },

        get enabled(): boolean {
            return voice.enabled;
        },

        setEnabled(on: boolean): void {
            voice.setEnabled(on);
        },

        update(step: RouteStep | null, distanceMetres: number): void {
            if (!step) return;
            if (step === announced) return;
            if (!(distanceMetres <= options.announceAtMetres)) return;
            // ⚠️ Marked as announced even when the platform is mute or the user has silenced it.
            // The alternative — only marking on a successful utterance — would make a manoeuvre
            // spoken the instant someone un-mutes, however far past it they are.
            announced = step;
            voice.say(sentence(step, distanceMetres));
        },

        destroy(): void {
            announced = null;
            // Cancels rather than merely stopping future announcements: a session that ends
            // while a sentence is in flight would otherwise keep instructing a driver about a
            // route they have left.
            voice.cancel();
        },
    };
}
