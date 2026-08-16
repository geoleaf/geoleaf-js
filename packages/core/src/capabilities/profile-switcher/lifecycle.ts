/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Profile-switcher capability — lifecycle / mount wiring.
 *
 * Subscribes to the kernel seam `geoleaf:layer-manager:panel` and inserts the selector
 * at the top of the panel. `registry.init()` runs AFTER `loadActiveProfileResources`,
 * so `getProfileSwitcherConfig()` already sees the merged config here — the late gate
 * (`enabled === true`, default OFF) decides visibility synchronously, as `theme-toggle`
 * does.
 *
 * The layer manager may be built BEFORE or AFTER this init, and it is rebuilt on a
 * destroy → recreate cycle. Hence: a live subscription (later builds) plus a catch-up
 * scan (earlier build), both funnelling into an idempotent insert.
 */

import { Log } from "../../utils/log/index.js";
import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { getAvailableProfiles, getProfileSwitcherConfig } from "./config.js";
import {
    createProfileSelect,
    syncProfileSelect,
    PROFILE_SWITCHER_CLASS,
} from "./profile-select.js";
import { switchToProfile } from "./profile-switch.js";
import type { LayerManagerPanelDetail } from "../../kernel/layer-manager/panel-seam.js";

let _started = false;
let _seamHandler: EventListener | null = null;

/** Reads the active profile id from the config facade (null before config load). */
function _activeProfileId(): string | null {
    const config = getGeoLeaf()?.Config as { getActiveProfileId?: () => unknown } | undefined;
    const id =
        typeof config?.getActiveProfileId === "function" ? config.getActiveProfileId() : null;
    return typeof id === "string" && id ? id : null;
}

/**
 * Inserts the selector between the header wrapper and the body wrapper.
 *
 * NOT inside the body: `renderSections()` empties that container on every render
 * (`render-sections.ts` → `clearElementFast`), so a selector mounted there would
 * vanish the first time a layer is toggled.
 *
 * Idempotent — the seam fires again on every panel rebuild.
 */
function _injectInto(detail: LayerManagerPanelDetail): void {
    const { container, mainWrapper, headerWrapper } = detail;
    if (container.querySelector(`.${PROFILE_SWITCHER_CLASS}`)) return;

    const profiles = getAvailableProfiles();
    // Offering a single option is a decoy: it advertises a choice that does not exist.
    if (profiles.length < 2) {
        Log?.debug?.(
            `[ProfileSwitcher] ${profiles.length} profile(s) available — selector not rendered`
        );
        return;
    }

    const activeId = _activeProfileId();
    const el = createProfileSelect(profiles, activeId, switchToProfile);
    mainWrapper.insertBefore(el, headerWrapper.nextSibling);

    // The active profile may not be known yet when the panel is built early; re-sync
    // once the app is ready rather than leaving the wrong option selected.
    if (!activeId && typeof document !== "undefined") {
        document.addEventListener(
            "geoleaf:app:ready",
            () => {
                const late = _activeProfileId();
                if (late) syncProfileSelect(el, late);
            },
            { once: true }
        );
    }

    Log?.info?.(`[ProfileSwitcher] Selector mounted (${profiles.length} profiles)`);
}

/** Catch-up for a layer manager already in the DOM when this capability initialises. */
function _injectIntoExistingPanel(): void {
    if (typeof document === "undefined") return;
    const container = document.querySelector<HTMLElement>(".gl-layer-manager");
    const mainWrapper = container?.querySelector<HTMLElement>(".gl-layer-manager__main-wrapper");
    const headerWrapper = container?.querySelector<HTMLElement>(
        ".gl-layer-manager__header-wrapper"
    );
    if (container && mainWrapper && headerWrapper) {
        _injectInto({ container, mainWrapper, headerWrapper });
    }
}

/** Idempotent mount for the profile-switcher capability. Safe to call twice. */
export const ProfileSwitcherLifecycle = {
    init(): void {
        if (_started || typeof document === "undefined") return;
        _started = true;

        // User-facing default OFF — opt-in on the merged config.
        if (getProfileSwitcherConfig().enabled !== true) return;

        _seamHandler = ((e: CustomEvent<LayerManagerPanelDetail>) => {
            if (e.detail) _injectInto(e.detail);
        }) as EventListener;
        document.addEventListener("geoleaf:layer-manager:panel", _seamHandler);

        // The panel may already exist (built before this capability's init).
        _injectIntoExistingPanel();
    },

    /** Detaches the listener and removes the selector (module destroy / test seam). */
    _reset(): void {
        if (typeof document !== "undefined") {
            if (_seamHandler) {
                document.removeEventListener("geoleaf:layer-manager:panel", _seamHandler);
            }
            // Query the whole document: the selector lives in a container this
            // capability does not own, and the class is its own, so nothing else can
            // match. Removing the node is also what releases its change listener.
            document.querySelectorAll(`.${PROFILE_SWITCHER_CLASS}`).forEach((el) => el.remove());
        }
        _seamHandler = null;
        _started = false;
    },
};
