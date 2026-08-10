/**
 * Unit tests — profile-select.ts + profile-switch.ts + lifecycle.ts (capability S1).
 *
 * Covers the DOM contract, the switch side effects (persistence + SW purge + reload)
 * and the two properties the CDC calls out as load-bearing:
 *   - the selector survives a `renderSections()` pass (it must NOT live in __body);
 *   - a second seam emission does not duplicate it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { Config } = await import("../../../src/kernel/config/config-primitives.ts");
const { createProfileSelect, syncProfileSelect, PROFILE_SWITCHER_CLASS } = await import(
    "../../../src/capabilities/profile-switcher/profile-select.ts"
);
const { switchToProfile, PROFILE_STORAGE_KEY } = await import(
    "../../../src/capabilities/profile-switcher/profile-switch.ts"
);
const { ProfileSwitcherLifecycle } = await import(
    "../../../src/capabilities/profile-switcher/lifecycle.ts"
);
const { emitLayerManagerPanel } = await import("../../../src/kernel/layer-manager/panel-seam.ts");

const PROFILES = [
    { id: "tourism", displayLabel: "Tourisme", icon: "🏖️" },
    { id: "france-rail", displayLabel: "France Rail" },
];

const _originalGet = Config.get;
function stubConfig(cfg) {
    Config.get = (path, def) => {
        const v = path.split(".").reduce((o, k) => o?.[k], cfg);
        return v === undefined ? def : v;
    };
}

/** Builds the layer-manager DOM shape the seam describes. */
function buildPanel() {
    const container = document.createElement("div");
    container.className = "gl-layer-manager";
    const mainWrapper = document.createElement("div");
    mainWrapper.className = "gl-layer-manager__main-wrapper";
    const headerWrapper = document.createElement("div");
    headerWrapper.className = "gl-layer-manager__header-wrapper";
    const bodyWrapper = document.createElement("div");
    bodyWrapper.className = "gl-layer-manager__body-wrapper";
    const body = document.createElement("div");
    body.className = "gl-layer-manager__body";
    bodyWrapper.appendChild(body);
    mainWrapper.append(headerWrapper, bodyWrapper);
    container.appendChild(mainWrapper);
    document.body.appendChild(container);
    return { container, mainWrapper, headerWrapper, bodyWrapper, body };
}

beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    sessionStorage.clear();
    ProfileSwitcherLifecycle._reset();
});

afterEach(() => {
    vi.restoreAllMocks();
    ProfileSwitcherLifecycle._reset();
    if (_originalGet === undefined) delete Config.get;
    else Config.get = _originalGet;
});

describe("createProfileSelect()", () => {
    it("renders one option per profile, icon prefixed when present", () => {
        const el = createProfileSelect(PROFILES, "tourism", () => {});
        const options = el.querySelectorAll("option");
        expect(options).toHaveLength(2);
        expect(options[0].textContent).toBe("🏖️ Tourisme");
        expect(options[1].textContent).toBe("France Rail");
    });

    it("marks the active profile as selected", () => {
        const el = createProfileSelect(PROFILES, "france-rail", () => {});
        expect(el.querySelector("select").value).toBe("france-rail");
    });

    it("carries an accessible name (no visible <label> is attached)", () => {
        const el = createProfileSelect(PROFILES, null, () => {});
        expect(el.querySelector("select").getAttribute("aria-label")).toBeTruthy();
    });

    it("calls onSwitch when a different profile is chosen", () => {
        const onSwitch = vi.fn();
        const el = createProfileSelect(PROFILES, "tourism", onSwitch);
        const select = el.querySelector("select");
        select.value = "france-rail";
        select.dispatchEvent(new Event("change"));
        expect(onSwitch).toHaveBeenCalledWith("france-rail");
    });

    it("does NOT call onSwitch when the active profile is re-selected", () => {
        // Reloading onto the profile already displayed would be a wasted round-trip.
        const onSwitch = vi.fn();
        const el = createProfileSelect(PROFILES, "tourism", onSwitch);
        const select = el.querySelector("select");
        select.value = "tourism";
        select.dispatchEvent(new Event("change"));
        expect(onSwitch).not.toHaveBeenCalled();
    });

    it("renders the label as text, never as markup", () => {
        // displayLabel comes from a profile JSON: data the core does not author.
        const el = createProfileSelect(
            [{ id: "x", displayLabel: "<img src=x onerror=alert(1)>" }],
            null,
            () => {}
        );
        expect(el.querySelector("option").innerHTML).not.toContain("<img");
    });

    it("syncProfileSelect() reflects a late-resolved active profile", () => {
        const el = createProfileSelect(PROFILES, null, () => {});
        syncProfileSelect(el, "france-rail");
        expect(el.querySelector("select").value).toBe("france-rail");
    });
});

describe("switchToProfile()", () => {
    let assigned;

    beforeEach(() => {
        assigned = null;
        delete window.location;
        window.location = { href: "https://example.test/?a=1" };
        Object.defineProperty(window.location, "href", {
            get: () => "https://example.test/?a=1",
            set: (v) => {
                assigned = v;
            },
            configurable: true,
        });
    });

    it("persists the choice in localStorage (durable) and sessionStorage (one-shot)", () => {
        switchToProfile("france-rail");
        expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBe("france-rail");
        expect(sessionStorage.getItem("gl-selected-profile")).toBe("france-rail");
    });

    it("reloads onto the chosen profile with a cache-busting stamp", () => {
        switchToProfile("france-rail");
        expect(assigned).toContain("profile=france-rail");
        expect(assigned).toMatch(/[?&]t=\d+/);
    });

    it("refuses a forged profile id without touching storage or navigating", () => {
        // The id reaches a fetch path — a forged one must never get through.
        switchToProfile("../../etc/passwd");
        expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
        expect(assigned).toBeNull();
    });

    it("still switches when localStorage is unavailable (private browsing)", () => {
        const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation((key) => {
            if (key === PROFILE_STORAGE_KEY) throw new Error("QuotaExceededError");
        });
        expect(() => switchToProfile("france-rail")).not.toThrow();
        expect(assigned).toContain("profile=france-rail");
        spy.mockRestore();
    });

    it("asks the service worker to drop its caches before reloading", () => {
        const postMessage = vi.fn();
        Object.defineProperty(navigator, "serviceWorker", {
            value: { controller: { postMessage } },
            configurable: true,
        });
        switchToProfile("france-rail");
        expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_CACHE" }, expect.any(Array));
    });
});

describe("ProfileSwitcherLifecycle", () => {
    it("does not mount when the capability is disabled (opt-in default)", () => {
        stubConfig({ data: { availableProfiles: PROFILES } });
        const panel = buildPanel();
        ProfileSwitcherLifecycle.init();
        emitLayerManagerPanel(panel);
        expect(document.querySelector(`.${PROFILE_SWITCHER_CLASS}`)).toBeNull();
    });

    it("does not mount with fewer than 2 profiles (a single option is a decoy)", () => {
        stubConfig({
            modules: { "profile-switcher": { enabled: true } },
            data: { availableProfiles: [PROFILES[0]] },
        });
        const panel = buildPanel();
        ProfileSwitcherLifecycle.init();
        emitLayerManagerPanel(panel);
        expect(document.querySelector(`.${PROFILE_SWITCHER_CLASS}`)).toBeNull();
    });

    it("mounts between the header wrapper and the body wrapper", () => {
        stubConfig({
            modules: { "profile-switcher": { enabled: true } },
            data: { availableProfiles: PROFILES },
        });
        const panel = buildPanel();
        ProfileSwitcherLifecycle.init();
        emitLayerManagerPanel(panel);

        const el = document.querySelector(`.${PROFILE_SWITCHER_CLASS}`);
        expect(el).not.toBeNull();
        expect(el.previousElementSibling).toBe(panel.headerWrapper);
        expect(el.nextElementSibling).toBe(panel.bodyWrapper);
    });

    it("survives a body re-render — it is NOT inside __body", () => {
        // renderSections() empties __body on every render; a selector mounted there
        // would vanish the first time a layer is toggled.
        stubConfig({
            modules: { "profile-switcher": { enabled: true } },
            data: { availableProfiles: PROFILES },
        });
        const panel = buildPanel();
        ProfileSwitcherLifecycle.init();
        emitLayerManagerPanel(panel);

        panel.body.replaceChildren(); // what clearElementFast does

        expect(document.querySelector(`.${PROFILE_SWITCHER_CLASS}`)).not.toBeNull();
    });

    it("does not duplicate on a second seam emission (panel rebuild)", () => {
        stubConfig({
            modules: { "profile-switcher": { enabled: true } },
            data: { availableProfiles: PROFILES },
        });
        const panel = buildPanel();
        ProfileSwitcherLifecycle.init();
        emitLayerManagerPanel(panel);
        emitLayerManagerPanel(panel);
        expect(document.querySelectorAll(`.${PROFILE_SWITCHER_CLASS}`)).toHaveLength(1);
    });

    it("catches up on a panel that already exists at init time", () => {
        stubConfig({
            modules: { "profile-switcher": { enabled: true } },
            data: { availableProfiles: PROFILES },
        });
        buildPanel(); // built BEFORE init — the seam already fired
        ProfileSwitcherLifecycle.init();
        expect(document.querySelector(`.${PROFILE_SWITCHER_CLASS}`)).not.toBeNull();
    });

    it("_reset() removes the selector and stops listening", () => {
        stubConfig({
            modules: { "profile-switcher": { enabled: true } },
            data: { availableProfiles: PROFILES },
        });
        const panel = buildPanel();
        ProfileSwitcherLifecycle.init();
        emitLayerManagerPanel(panel);
        expect(document.querySelector(`.${PROFILE_SWITCHER_CLASS}`)).not.toBeNull();

        ProfileSwitcherLifecycle._reset();
        expect(document.querySelector(`.${PROFILE_SWITCHER_CLASS}`)).toBeNull();

        emitLayerManagerPanel(panel);
        expect(document.querySelector(`.${PROFILE_SWITCHER_CLASS}`)).toBeNull();
    });
});
