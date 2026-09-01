/**
 * Unit tests — the three platform adapters.
 *
 * 🛑 No network calls, no browser. The APIs are doubled, which is possible
 * BECAUSE each enters at one place only — the property `PLATFORM-ISO` guards.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startGeoWatch } from "../platform/geo.js";
import { createScreenWakeLock } from "../platform/wake-lock.js";
import { createVoiceAnnouncer } from "../platform/voice.js";

/** A synthetic fix, in the shape the platform returns. */
function pos(lng: number, lat: number, t: number, extra: Record<string, unknown> = {}) {
    return {
        coords: {
            longitude: lng,
            latitude: lat,
            accuracy: 5,
            heading: null,
            speed: null,
            ...extra,
        },
        timestamp: t,
    } as unknown as GeolocationPosition;
}

describe("startGeoWatch", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("dit `unsupported` plutôt que de jeter, quand il n'y a pas de géolocalisation", () => {
        // An insecure origin, a stripped-down host. Throwing would take down
        // the guidance start on an absence that is an ordinary answer.
        vi.stubGlobal("navigator", {});
        const onFailure = vi.fn();
        const stop = startGeoWatch({ onFix: vi.fn(), onFailure });
        expect(onFailure).toHaveBeenCalledWith("unsupported");
        expect(() => stop()).not.toThrow();
    });

    it("ACCEPTE le premier relevé — il n'a rien contre quoi être invraisemblable", () => {
        // 🛑 Refusing it would leave the guidance waiting for a second fix: on
        // a slow sensor, tens of seconds of a screen saying nothing.
        let cb: ((p: GeolocationPosition) => void) | null = null;
        vi.stubGlobal("navigator", {
            geolocation: {
                watchPosition: (f: (p: GeolocationPosition) => void) => ((cb = f), 1),
                clearWatch: vi.fn(),
            },
        });
        const onFix = vi.fn();
        startGeoWatch({ onFix, onFailure: vi.fn() });
        cb!(pos(55, -21, 1000));
        expect(onFix).toHaveBeenCalledTimes(1);
    });

    it("rejette un SAUT invraisemblable, et garde le relevé plausible qui suit", () => {
        let cb: ((p: GeolocationPosition) => void) | null = null;
        vi.stubGlobal("navigator", {
            geolocation: {
                watchPosition: (f: (p: GeolocationPosition) => void) => ((cb = f), 1),
                clearWatch: vi.fn(),
            },
        });
        const onFix = vi.fn();
        startGeoWatch({ onFix, onFailure: vi.fn(), maxSpeedMps: 55 });
        cb!(pos(55.0, -21.0, 1000));
        cb!(pos(56.0, -21.0, 2000)); // ~104 km en 1 s
        cb!(pos(55.0005, -21.0, 3000)); // ~52 m en 2 s depuis le dernier ACCEPTÉ
        expect(onFix).toHaveBeenCalledTimes(2);
        expect(onFix.mock.calls[1]![0].position[0]).toBeCloseTo(55.0005, 6);
    });

    it("🛑 ne JETTE PAS un relevé quasi immobile — c'est l'autre moitié du filtre, non reprise", () => {
        // `tool-gps.ts`'s pattern drops under 2 m, which is right for
        // collecting vertices. Here, a stopped vehicle would cease to exist,
        // the state machine would receive nothing, and a walking-pace approach
        // to a waypoint would never enter the arrival radius.
        let cb: ((p: GeolocationPosition) => void) | null = null;
        vi.stubGlobal("navigator", {
            geolocation: {
                watchPosition: (f: (p: GeolocationPosition) => void) => ((cb = f), 1),
                clearWatch: vi.fn(),
            },
        });
        const onFix = vi.fn();
        startGeoWatch({ onFix, onFailure: vi.fn() });
        cb!(pos(55, -21, 1000));
        cb!(pos(55, -21, 2000));
        cb!(pos(55, -21, 3000));
        expect(onFix).toHaveBeenCalledTimes(3);
    });

    it("ne divise jamais par une horloge qui n'avance pas", () => {
        // Some hosts repeat a timestamp. Dividing by zero would make every
        // step infinitely fast and drop the whole stream.
        let cb: ((p: GeolocationPosition) => void) | null = null;
        vi.stubGlobal("navigator", {
            geolocation: {
                watchPosition: (f: (p: GeolocationPosition) => void) => ((cb = f), 1),
                clearWatch: vi.fn(),
            },
        });
        const onFix = vi.fn();
        startGeoWatch({ onFix, onFailure: vi.fn() });
        cb!(pos(55, -21, 1000));
        cb!(pos(55.5, -21, 1000));
        expect(onFix).toHaveBeenCalledTimes(2);
    });

    it("traite `NaN` comme une absence de cap", () => {
        let cb: ((p: GeolocationPosition) => void) | null = null;
        vi.stubGlobal("navigator", {
            geolocation: {
                watchPosition: (f: (p: GeolocationPosition) => void) => ((cb = f), 1),
                clearWatch: vi.fn(),
            },
        });
        const onFix = vi.fn();
        startGeoWatch({ onFix, onFailure: vi.fn() });
        cb!(pos(55, -21, 1000, { heading: Number.NaN, speed: 12 }));
        expect(onFix.mock.calls[0]![0].heading).toBeNull();
        expect(onFix.mock.calls[0]![0].speed).toBe(12);
    });

    it("nomme les trois refus de la plateforme", () => {
        const cases: [number, string][] = [
            [1, "denied"],
            [2, "unavailable"],
            [3, "timeout"],
        ];
        for (const [code, expected] of cases) {
            vi.stubGlobal("navigator", {
                geolocation: {
                    watchPosition: (_f: unknown, e: (x: unknown) => void) => (e({ code }), 1),
                    clearWatch: vi.fn(),
                },
            });
            const onFailure = vi.fn();
            startGeoWatch({ onFix: vi.fn(), onFailure });
            expect(onFailure).toHaveBeenCalledWith(expected);
        }
    });

    it("arrête la veille, et l'arrêt est IDEMPOTENT", () => {
        // Guidance stops by the user, by the arrival, and by teardown. Those
        // races are real; a second `clearWatch` on a released id is useless at
        // best, an error on some engines at worst.
        const clearWatch = vi.fn();
        vi.stubGlobal("navigator", { geolocation: { watchPosition: () => 7, clearWatch } });
        const stop = startGeoWatch({ onFix: vi.fn(), onFailure: vi.fn() });
        stop();
        stop();
        expect(clearWatch).toHaveBeenCalledTimes(1);
        expect(clearWatch).toHaveBeenCalledWith(7);
    });
});

describe("createScreenWakeLock — le piège de cette API", () => {
    let listeners: Record<string, (() => void)[]>;
    let doc: Document;

    beforeEach(() => {
        listeners = {};
        doc = {
            visibilityState: "visible",
            addEventListener: (t: string, f: () => void) => {
                (listeners[t] ??= []).push(f);
            },
            removeEventListener: (t: string, f: () => void) => {
                listeners[t] = (listeners[t] ?? []).filter((x) => x !== f);
            },
        } as unknown as Document;
    });
    afterEach(() => vi.unstubAllGlobals());

    /** Emits a visibility change. */
    const fireVisibility = () => (listeners["visibilitychange"] ?? []).forEach((f) => f());

    it("🛑 RÉ-ACQUIERT au retour au premier plan — le défaut classique de cette API", async () => {
        // The browser RELEASES the lock as soon as the document stops being
        // visible, and never restores it. An implementation requesting once
        // passes every test and lets the screen go dark at the first glance at
        // a message — in the car, minutes later, the worst moment to find out.
        const request = vi
            .fn()
            .mockResolvedValue({ release: vi.fn().mockResolvedValue(undefined) });
        vi.stubGlobal("navigator", { wakeLock: { request } });
        const lock = createScreenWakeLock(doc);
        await lock.acquire();
        expect(request).toHaveBeenCalledTimes(1);

        fireVisibility();
        await Promise.resolve();
        await Promise.resolve();
        expect(request).toHaveBeenCalledTimes(2);
    });

    it("ne ré-acquiert PAS quand le document redevient caché", async () => {
        const request = vi
            .fn()
            .mockResolvedValue({ release: vi.fn().mockResolvedValue(undefined) });
        vi.stubGlobal("navigator", { wakeLock: { request } });
        const lock = createScreenWakeLock(doc);
        await lock.acquire();
        (doc as unknown as { visibilityState: string }).visibilityState = "hidden";
        fireVisibility();
        await Promise.resolve();
        expect(request).toHaveBeenCalledTimes(1);
    });

    it("ne ré-acquiert plus après `release` — le guidage est fini", async () => {
        const request = vi
            .fn()
            .mockResolvedValue({ release: vi.fn().mockResolvedValue(undefined) });
        vi.stubGlobal("navigator", { wakeLock: { request } });
        const lock = createScreenWakeLock(doc);
        await lock.acquire();
        await lock.release();
        fireVisibility();
        await Promise.resolve();
        expect(request).toHaveBeenCalledTimes(1);
        expect(listeners["visibilitychange"] ?? []).toHaveLength(0);
    });

    it("avale un refus — un verrou d'écran est un confort, jamais un prérequis", async () => {
        // Refused on insecure origins, low battery, policy. A guidance that
        // stopped because the screen might go dark would be worse than a
        // screen going dark.
        vi.stubGlobal("navigator", {
            wakeLock: { request: vi.fn().mockRejectedValue(new Error("policy")) },
        });
        const lock = createScreenWakeLock(doc);
        await expect(lock.acquire()).resolves.toBeUndefined();
        expect(lock.held).toBe(false);
    });

    it("ne jette pas quand la plateforme n'a pas d'API du tout", async () => {
        vi.stubGlobal("navigator", {});
        const lock = createScreenWakeLock(doc);
        await expect(lock.acquire()).resolves.toBeUndefined();
        await expect(lock.release()).resolves.toBeUndefined();
    });

    it("dit ne rien tenir même si la libération échoue", async () => {
        // The page may have been discarded. The object must stay honest about what it holds.
        const release = vi.fn().mockRejectedValue(new Error("gone"));
        vi.stubGlobal("navigator", {
            wakeLock: { request: vi.fn().mockResolvedValue({ release }) },
        });
        const lock = createScreenWakeLock(doc);
        await lock.acquire();
        expect(lock.held).toBe(true);
        await lock.release();
        expect(lock.held).toBe(false);
    });

    it("`acquire` deux fois n'ajoute qu'UN écouteur", async () => {
        vi.stubGlobal("navigator", {
            wakeLock: { request: vi.fn().mockResolvedValue({ release: vi.fn() }) },
        });
        const lock = createScreenWakeLock(doc);
        await lock.acquire();
        await lock.acquire();
        expect(listeners["visibilitychange"]).toHaveLength(1);
    });
});

describe("createVoiceAnnouncer", () => {
    afterEach(() => vi.unstubAllGlobals());

    /** Speech-synthesis double, which records what it is asked. */
    function stubSpeech() {
        const speak = vi.fn();
        const cancel = vi.fn();
        vi.stubGlobal("speechSynthesis", { speak, cancel });
        vi.stubGlobal(
            "SpeechSynthesisUtterance",
            class {
                lang = "";
                constructor(public text: string) {}
            }
        );
        return { speak, cancel };
    }

    it("se déclare indisponible plutôt que d'offrir un contrôle qui ne fait rien", () => {
        vi.stubGlobal("speechSynthesis", undefined);
        vi.stubGlobal("SpeechSynthesisUtterance", undefined);
        const v = createVoiceAnnouncer("fr-FR");
        expect(v.available).toBe(false);
        expect(v.enabled).toBe(false);
        expect(() => v.say("tourner à droite")).not.toThrow();
    });

    it("dit le texte, dans la langue qu'on lui donne", () => {
        const { speak } = stubSpeech();
        createVoiceAnnouncer("fr-FR").say("Dans 200 mètres, tournez à droite");
        expect(speak).toHaveBeenCalledTimes(1);
        expect(speak.mock.calls[0]![0].text).toBe("Dans 200 mètres, tournez à droite");
        expect(speak.mock.calls[0]![0].lang).toBe("fr-FR");
    });

    it("🛑 REMPLACE ce qui attendait au lieu de faire la queue", () => {
        // Guidance speaks about NOW. A queue guarantees each announcement
        // delays the next, so the lag accumulates and a turn already taken gets announced.
        const { speak, cancel } = stubSpeech();
        const v = createVoiceAnnouncer("fr-FR");
        v.say("premier");
        v.say("second");
        expect(cancel).toHaveBeenCalledTimes(2);
        expect(speak).toHaveBeenCalledTimes(2);
    });

    it("🛑 couper le son ANNULE ce qui est en train d'être dit", () => {
        // A switch stopping only FUTURE announcements would leave the driver
        // who just pressed "mute" listening to twenty seconds of instructions
        // — which reads as a control that does not work, and that is why they pressed it.
        const { cancel } = stubSpeech();
        const v = createVoiceAnnouncer("fr-FR");
        v.setEnabled(false);
        expect(cancel).toHaveBeenCalled();
        expect(v.enabled).toBe(false);
    });

    it("se tait tant qu'il est coupé, et reparle quand on le rallume", () => {
        const { speak } = stubSpeech();
        const v = createVoiceAnnouncer("fr-FR");
        v.setEnabled(false);
        v.say("rien");
        expect(speak).not.toHaveBeenCalled();
        v.setEnabled(true);
        v.say("quelque chose");
        expect(speak).toHaveBeenCalledTimes(1);
    });

    it("ignore un texte vide plutôt que de faire parler le silence", () => {
        const { speak } = stubSpeech();
        createVoiceAnnouncer("fr-FR").say("");
        expect(speak).not.toHaveBeenCalled();
    });

    it("ne peut PAS être rallumé sur une plateforme muette", () => {
        // Otherwise `enabled` would lie, and the interface would show an
        // active button on an engine that will never say anything.
        vi.stubGlobal("speechSynthesis", undefined);
        vi.stubGlobal("SpeechSynthesisUtterance", undefined);
        const v = createVoiceAnnouncer("fr-FR");
        v.setEnabled(true);
        expect(v.enabled).toBe(false);
    });
});
