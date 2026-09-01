/**
 * `@geoleaf-plugins/navigation` — the announcement POLICY.
 *
 * 🛑 What is under test here is *when* something is said, never *how*. The speaking half has its
 * own suite (`platform-adapters.test.ts`) and is doubled here, because the defects this file
 * exists for are all policy: a manoeuvre said twice, a manoeuvre said kilometres early, a
 * manoeuvre on a brand-new route left silent because the index happened to repeat.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RouteStep } from "@geoleaf-plugins/routing";

const { voiceMock, tLabelMock } = vi.hoisted(() => ({
    voiceMock: {
        available: true,
        enabled: true,
        setEnabled: vi.fn(),
        say: vi.fn(),
        cancel: vi.fn(),
    },
    tLabelMock: vi.fn(),
}));
vi.mock("../platform/voice.js", () => ({ createVoiceAnnouncer: () => voiceMock }));
vi.mock("@geoleaf/host-runtime", () => ({
    tLabel: (...a: unknown[]) => tLabelMock(...a),
    getActiveLang: () => "fr",
}));

const { createAnnouncer } = await import("../ui/announcer.js");

/** A step, as `routing` normalises it. Distinct OBJECTS matter here — see the identity rule. */
function step(over: Record<string, unknown> = {}): RouteStep {
    return {
        maneuver: "turn",
        modifier: "left",
        name: "Rue de la Paix",
        distance: 400,
        duration: 60,
        ...over,
    } as unknown as RouteStep;
}

const FR: Record<string, string> = {
    "navigation.voice.ahead": "Dans {0}, {1}",
    "navigation.voice.unit.metres": "mètres",
    "navigation.voice.unit.kilometres": "kilomètres",
    "navigation.maneuver.turn.left": "Tournez à gauche",
    "navigation.maneuver.unknown": "Poursuivez",
};

describe("createAnnouncer — quand une manœuvre est dite", () => {
    beforeEach(() => {
        voiceMock.setEnabled.mockReset();
        voiceMock.say.mockReset();
        voiceMock.cancel.mockReset();
        tLabelMock.mockImplementation((k: string, fb?: string) => FR[k] ?? fb ?? k);
    });

    it("applique l'état de DÉPART venu du profil", () => {
        createAnnouncer({ enabled: false, announceAtMetres: 200 });
        expect(voiceMock.setEnabled).toHaveBeenCalledWith(false);
    });

    it("🛑 ne dit RIEN tant qu'on est plus loin que le seuil", () => {
        // Announced the instant it becomes "next", a manoeuvre is announced kilometres early —
        // and by the time it matters the driver has forgotten it.
        const a = createAnnouncer({ enabled: true, announceAtMetres: 200 });
        a.update(step(), 900);
        a.update(step(), 400);
        expect(voiceMock.say).not.toHaveBeenCalled();
    });

    it("dit la manœuvre en entrant dans le seuil, et UNE SEULE FOIS", () => {
        const a = createAnnouncer({ enabled: true, announceAtMetres: 200 });
        const s = step();
        a.update(s, 300);
        a.update(s, 180);
        a.update(s, 120);
        a.update(s, 40);
        expect(voiceMock.say).toHaveBeenCalledTimes(1);
    });

    it("🛑 une manœuvre plus COURTE que le seuil est annoncée aussitôt", () => {
        // Not an edge case: a 60 m step is already inside the threshold the moment it becomes
        // next. Waiting for a crossing that will never happen would leave it silent.
        const a = createAnnouncer({ enabled: true, announceAtMetres: 200 });
        a.update(step({ distance: 60 }), 60);
        expect(voiceMock.say).toHaveBeenCalledTimes(1);
    });

    it("🛑 un RECALCUL fait ré-annoncer — l'identité est l'objet, jamais l'index", () => {
        // After a recomputation, index 0 is a DIFFERENT step on a DIFFERENT route. Keying on the
        // number would leave the first manoeuvre of the new route silent, which is the one that
        // matters most: the driver has just been told they are off route.
        const a = createAnnouncer({ enabled: true, announceAtMetres: 200 });
        a.update(step(), 100);
        expect(voiceMock.say).toHaveBeenCalledTimes(1);
        a.update(step(), 100); // same content, DIFFERENT object — this is a new route
        expect(voiceMock.say).toHaveBeenCalledTimes(2);
    });

    it("rien à annoncer ne fait rien, et n'oublie pas ce qui l'a été", () => {
        const a = createAnnouncer({ enabled: true, announceAtMetres: 200 });
        const s = step();
        a.update(s, 100);
        a.update(null, 0);
        a.update(s, 80);
        expect(voiceMock.say).toHaveBeenCalledTimes(1);
    });

    it("🛑 marque comme annoncé MÊME muet — sinon dé-muter recrache une manœuvre passée", () => {
        // The alternative — marking only on a successful utterance — makes a manoeuvre spoken
        // the instant someone un-mutes, however far past it they already are.
        voiceMock.say.mockImplementation(() => {});
        const a = createAnnouncer({ enabled: false, announceAtMetres: 200 });
        const s = step();
        a.update(s, 100);
        a.setEnabled(true);
        a.update(s, 50);
        expect(voiceMock.say).toHaveBeenCalledTimes(1);
    });

    it("compose avec les unités PARLÉES, pas celles du bandeau", () => {
        // A synthesiser reads "m" as the letter: "dans deux cents m" is not a sentence.
        const a = createAnnouncer({ enabled: true, announceAtMetres: 200 });
        a.update(step(), 200);
        expect(voiceMock.say).toHaveBeenCalledWith("Dans 200 mètres, Tournez à gauche");
    });

    it("couper délègue l'annulation, et le démontage fait taire", () => {
        const a = createAnnouncer({ enabled: true, announceAtMetres: 200 });
        a.setEnabled(false);
        expect(voiceMock.setEnabled).toHaveBeenLastCalledWith(false);
        a.destroy();
        expect(voiceMock.cancel).toHaveBeenCalledTimes(1);
    });

    it("après démontage, la même manœuvre peut être re-annoncée", () => {
        // `destroy` forgets: the next session starts from nothing, and a step object reused
        // across two journeys must not be silenced by the first one.
        const a = createAnnouncer({ enabled: true, announceAtMetres: 200 });
        const s = step();
        a.update(s, 100);
        a.destroy();
        a.update(s, 100);
        expect(voiceMock.say).toHaveBeenCalledTimes(2);
    });
});
