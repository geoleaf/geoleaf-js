// @vitest-environment happy-dom
/*!
 * @geoleaf/host-runtime — geolocation-seam tests
 * © 2026 Mattieu Pottier — MIT License
 *
 * The core's capability is stood in for by a live state and a control link whose click toggles
 * the watch, as the real one does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    isGeolocationActive,
    isGeolocationEnabled,
    readUserPosition,
    requestUserPosition,
    type UserPosition,
} from "../geolocation-seam.js";

type State = { active: boolean; userPosition: UserPosition | null };
type Carrier = { GeoLeaf?: { Geolocation?: unknown } };
const carrier = globalThis as Carrier;

let state: State;
let clicks: number;

/** Mounts the capability; `onClick` plays the device's answer to the toggle. */
function mount(options: { enabled?: boolean; onClick?: () => void } = {}): void {
    state = { active: false, userPosition: null };
    clicks = 0;
    carrier.GeoLeaf = {
        Geolocation: { isEnabled: () => options.enabled !== false, getState: () => state },
    };
    const control = document.createElement("div");
    control.className = "geoleaf-ctrl-geolocation";
    const link = document.createElement("a");
    link.addEventListener("click", () => {
        clicks += 1;
        options.onClick?.();
    });
    control.append(link);
    document.body.append(control);
}

/** What the core does on its first fix. */
function fix(lat: number, lng: number): void {
    state.active = true;
    state.userPosition = { lat, lng, accuracy: 12 };
    document.body.dispatchEvent(
        new CustomEvent("geoleaf:geolocation:statechange", {
            detail: { active: true },
            bubbles: true,
        })
    );
}

/** What the core does on a refusal or a timeout: stop, forget, say `active: false`. */
function stop(): void {
    state.active = false;
    state.userPosition = null;
    document.body.dispatchEvent(
        new CustomEvent("geoleaf:geolocation:statechange", {
            detail: { active: false },
            bubbles: true,
        })
    );
}

beforeEach(() => {
    document.body.innerHTML = "";
});

afterEach(() => {
    delete carrier.GeoLeaf;
    vi.useRealTimers();
});

describe("isGeolocationEnabled", () => {
    it("is false without the capability, and when the profile turns it off", () => {
        expect(isGeolocationEnabled()).toBe(false);
        mount({ enabled: false });
        expect(isGeolocationEnabled()).toBe(false);
        mount();
        expect(isGeolocationEnabled()).toBe(true);
    });
});

describe("isGeolocationActive", () => {
    it("says whether the watch is on, fix or not, and false without the capability", () => {
        expect(isGeolocationActive()).toBe(false);
        mount();
        expect(isGeolocationActive()).toBe(false);
        state.active = true;
        expect(isGeolocationActive()).toBe(true);
    });
});

describe("readUserPosition", () => {
    it("reads the fix only while the watch is on", () => {
        mount();
        expect(readUserPosition()).toBeNull();
        fix(-20.88, 55.45);
        expect(readUserPosition()).toMatchObject({ lat: -20.88, lng: 55.45 });
        state.active = false;
        expect(readUserPosition()).toBeNull();
    });

    it("refuses a fix that is not two finite numbers", () => {
        mount();
        state.active = true;
        state.userPosition = { lat: Number.NaN, lng: 55 };
        expect(readUserPosition()).toBeNull();
    });
});

describe("requestUserPosition", () => {
    it("answers at once with the fix held, without touching the control", async () => {
        mount();
        fix(-20.88, 55.45);
        await expect(requestUserPosition()).resolves.toMatchObject({ lat: -20.88, lng: 55.45 });
        expect(clicks).toBe(0);
    });

    it("switches the GPS on through the core's control, and resolves with the first fix", async () => {
        mount({ onClick: () => queueMicrotask(() => fix(-21.1, 55.5)) });
        await expect(requestUserPosition()).resolves.toMatchObject({ lat: -21.1, lng: 55.5 });
        expect(clicks).toBe(1);
    });

    it("never clicks a watch already on — the click would switch it off — and waits for its fix", async () => {
        mount();
        state.active = true;
        const pending = requestUserPosition();
        fix(-21.2, 55.6);
        await expect(pending).resolves.toMatchObject({ lat: -21.2 });
        expect(clicks).toBe(0);
    });

    it("resolves null when the core stops the watch — a refusal reads like that", async () => {
        mount({ onClick: () => queueMicrotask(stop) });
        await expect(requestUserPosition()).resolves.toBeNull();
    });

    it("resolves null after its own timeout, and stops listening", async () => {
        vi.useFakeTimers();
        mount();
        const pending = requestUserPosition({ timeoutMs: 1000 });
        vi.advanceTimersByTime(1000);
        await expect(pending).resolves.toBeNull();
        fix(-20, 55);
        expect(clicks).toBe(1);
    });

    it("resolves null without the capability, or without its control", async () => {
        await expect(requestUserPosition()).resolves.toBeNull();
        mount();
        document.body.innerHTML = "";
        await expect(requestUserPosition()).resolves.toBeNull();
    });
});
