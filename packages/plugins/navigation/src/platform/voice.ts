/*!
 * @geoleaf-plugins/navigation — Spoken announcements
 *
 * Says a manoeuvre out loud, and stops saying anything the moment the user turns it off.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * ## Why turning it off CANCELS rather than just stopping new announcements
 *
 * Speech synthesis queues. An announcement handed over three seconds ago is still speaking,
 * and two more may be waiting behind it. A switch that only stopped *future* announcements
 * would leave a driver who just pressed "quiet" listening to the next twenty seconds of
 * instructions — which reads as a control that does not work, and is the reason they pressed
 * it in the first place.
 *
 * ## Why an announcement replaces the queue instead of joining it
 *
 * Guidance speaks about NOW. "In two hundred metres, turn right" is worthless once the turn
 * has been taken, and a queue guarantees exactly that: each announcement delays the next, so
 * the backlog grows and every instruction arrives later than the one before. Speaking the
 * newest and discarding what was waiting keeps the voice in step with the road.
 *
 * ⚠️ Text arrives from a routing provider, so it is **not trusted content**. It is passed to
 * the platform as a string and never rendered as markup — this module builds no DOM at all,
 * which is the strongest form of that guarantee rather than a rule to remember.
 */

/** A voice that can be silenced. */
export interface VoiceAnnouncer {
    /** Whether the platform can speak at all. */
    readonly available: boolean;
    /** Whether announcements are currently allowed. */
    readonly enabled: boolean;
    /** Turns announcements on or off. Turning off cancels what is speaking or queued. */
    setEnabled(on: boolean): void;
    /**
     * Says something, replacing anything still pending.
     *
     * @param text What to say. Provider text — untrusted, and never treated as markup.
     */
    say(text: string): void;
    /** Stops immediately without changing the enabled state. */
    cancel(): void;
}

/** The slice of the platform this needs, named so a test can supply it. */
interface SpeechCapable {
    speak(utterance: SpeechSynthesisUtterance): void;
    cancel(): void;
}

/**
 * Creates an announcer.
 *
 * @param lang BCP-47 tag for the interface language, e.g. `"fr-FR"`. Passed in rather than
 *             read from a global: this package holds no strings and picks no language.
 * @returns The announcer. Always usable — when the platform cannot speak, every call is a
 *          no-op and `available` says so, which lets the interface hide its toggle instead of
 *          offering a control that does nothing.
 */
export function createVoiceAnnouncer(lang: string): VoiceAnnouncer {
    const synth = globalThis.speechSynthesis as SpeechCapable | undefined;
    const Utterance = globalThis.SpeechSynthesisUtterance;
    const available = !!synth && typeof Utterance === "function";
    let enabled = available;

    return {
        available,

        get enabled(): boolean {
            return enabled && available;
        },

        setEnabled(on: boolean): void {
            enabled = on;
            // 🛑 Cancel on the way DOWN, always — see the note above. Doing it only when
            // something is known to be speaking would need a flag that the platform already
            // keeps and that no engine reports the same way.
            if (!on) synth?.cancel();
        },

        say(text: string): void {
            if (!available || !enabled || !text) return;
            // Replaces rather than queues: guidance speaks about now.
            synth?.cancel();
            const u = new Utterance(text);
            u.lang = lang;
            synth?.speak(u);
        },

        cancel(): void {
            synth?.cancel();
        },
    };
}
