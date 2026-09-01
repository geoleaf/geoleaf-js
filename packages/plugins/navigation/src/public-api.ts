/*!
 * @geoleaf-plugins/navigation — Public API
 *
 * What `GeoLeaf.Navigation` offers. Delegation only — `INV-FACADE`.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { RouteResult } from "@geoleaf-plugins/routing";
import { getPluginConfig, type PluginConfig } from "./config.js";
import type { Position } from "./engine/snap.js";
import type { GuidanceListener } from "./guidance-contract.js";
import {
    isGuiding,
    startSession,
    stopSession,
    onProgress,
    setVoiceEnabled,
    isVoiceEnabled,
    isVoiceAvailable,
    type GuidanceDeps,
} from "./session.js";

export type { GuidanceDeps };

/**
 * The `GeoLeaf.Navigation` surface.
 *
 * ⚠️ Guidance is entered from the ROUTE, never from a toolbar button: there is nothing to
 * guide along until a route exists, so a button would be a control that does nothing most of
 * the time. `modules.navigation.showButton` stays `false` for exactly that reason, and the
 * entry point lives where the route does — in the panel of `@geoleaf-plugins/routing`.
 */
export interface NavigationPublicApi {
    /** The effective `modules.navigation` configuration. */
    getConfig(): PluginConfig;
    /** Whether guidance is running. */
    isGuiding(): boolean;
    /**
     * Starts guiding along `route`.
     *
     * @param route The route to follow, as any provider normalised it.
     * @param line  Its geometry, ALREADY DECODED — this package may not import a codec.
     * @param deps  How to recompute and how to decode what comes back.
     */
    start(route: RouteResult, line: readonly Position[], deps: GuidanceDeps): void;
    /** Stops guidance and releases the platform. Idempotent. */
    stop(): void;
    /**
     * Subscribes to progress samples.
     *
     * @param listener Called for every accepted fix.
     * @returns The unsubscribe function.
     */
    onProgress(listener: GuidanceListener): () => void;
    /**
     * Turns spoken announcements on or off for the running session.
     *
     * ⚠️ Session-scoped: `modules.navigation.voiceEnabled` is the STARTING state and each session
     * starts from the profile again. Without this member that key would be settable only in a
     * file, which contradicts the contract it is documented under — "switchable in session".
     *
     * @param on Whether announcements are allowed. Turning them off silences what is speaking.
     */
    setVoiceEnabled(on: boolean): void;
    /** Whether announcements are currently allowed. `false` when nothing is running. */
    isVoiceEnabled(): boolean;
    /**
     * Whether the platform can speak at all.
     *
     * An interface should hide its toggle on `false` rather than offer a dead control — the same
     * reasoning that keeps `showButton` at `false` while there is no panel to open.
     */
    isVoiceAvailable(): boolean;
}

/**
 * Builds the namespace surface.
 *
 * @returns The API — thin delegates, no state.
 */
export function buildPublicApi(): NavigationPublicApi {
    return {
        getConfig: (): PluginConfig => getPluginConfig(),
        isGuiding: (): boolean => isGuiding(),
        start: (route, line, deps): void => startSession(route, line, deps),
        stop: (): void => stopSession(),
        onProgress: (listener): (() => void) => onProgress(listener),
        setVoiceEnabled: (on): void => setVoiceEnabled(on),
        isVoiceEnabled: (): boolean => isVoiceEnabled(),
        isVoiceAvailable: (): boolean => isVoiceAvailable(),
    };
}
