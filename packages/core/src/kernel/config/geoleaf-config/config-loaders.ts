/*!
 * GeoLeaf Core – Config / Loaders
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @sideEffectGraft packages/core/src/globals/globals.config.ts
 *
 * ✅ ASSUMED as a module-level state, decided 24-25/08/2026 — not a side effect awaiting
 * conversion. Converting the graft to plain exports would force the anchor to know every
 * member it re-exports, for nothing measurable: the graft is declared (this mark), anchored
 * (the bare import the mark names), and guarded (the graft gate reddens if either
 * disappears). What would REOPEN the decision is a second writer grafting onto the same
 * base — not a re-reading of this file.
 *
 * ⚠️ **SIDE-EFFECT module**: grafts 2 loaders onto `Config` at import. It exports
 * nothing that is consumed, so no dead-code instrument can see it live — ESLint,
 * `check-orphan-exports` and a human read all declared it dead **in concert, and all
 * three were wrong**. A side-effect module has no consumer, by definition.
 *
 * **Its only anchor is a BARE import in `globals.config.ts`.** Removing it drops
 * this file from the graph **silently**: the test suite stays green, and the symptom
 * is a production `TypeError`. It happened (July 2026, caught within the hour).
 * `GRAFT-03` now guards that the anchor still imports it.
 */
import { Log } from "../../../utils/log/index.js";
import { Config } from "./config-core.js";
import { ConfigLoader } from "../loader.js";
import { ProfileManager } from "../profile.js";
import type { GeoLeafConfig, LoadUrlOptions } from "./config-types.js";

// No local interface, no cast — see config-accessors.ts.
const C = Config;

C.loadUrl = function (url: string, options: LoadUrlOptions = {}): Promise<GeoLeafConfig> {
    const Loader = ConfigLoader;
    if (!Loader) {
        Log.error("[GeoLeaf.Config] Loader module not available.");
        return Promise.reject(new Error("Loader module not available"));
    }
    return Loader.loadUrl(url, options)
        .then((jsonCfg) => {
            this._applyConfig(jsonCfg, "url");
            this._maybeFireLoadedEvent();
            return this._config;
        })
        .catch((err) => {
            // 🛑 THIS `catch` REJECTS — decided on 19/08/2026, and it is an ASSUMED
            // BREAK.
            //
            // It resolved, and that is what made the failure unattributable
            // downstream — far more than its possible silence.
            //
            // Measured on 19/08/2026 by simulating a host whose router returns its
            // own HTML as 200 on this path: the console does carry two precise
            // errors (the content-type check does its job), then — because this
            // promise is fulfilled — the initialisation manager announces
            // "Configuration loaded successfully", and five CONSEQUENCE errors
            // follow: no active profile, no `map.bounds`, adapter not found, UI
            // skipped, registry in failure. **None names the cause.** An integrator
            // reads a success, then five map failures, and searches the map.
            //
            // ✅ WHAT CHANGED, and why. The messages below named the consequence,
            // which made the following five attributable — but READABLE is not
            // IMPOSSIBLE: an integrator not reading their console still saw a
            // success followed by a blank map. Rejecting makes the contradiction
            // impossible.
            //
            // This is a boot behaviour change of a PUBLISHED core — boot stops
            // instead of degrading — and it was DECIDED, not deduced. The messages
            // stay: they carry the cause, and a rejection with no named cause would
            // only have moved the problem.
            //
            // ⚠️ The chain above already rejected correctly — `_initFromUrl`
            // re-throws, the initialisation manager re-throws, `bootWithPreset` has
            // its stop path. This `catch` was the ONE place where a failure became
            // a success.
            Log.error("[GeoLeaf.Config] Error loading config:", err);
            Log.error(
                `[GeoLeaf.Config] La configuration de « ${url} » n'a PAS été appliquée, et le ` +
                    `boot S'ARRÊTE ici — il ne se dégrade plus en carte blanche. Cause ` +
                    `probable : l'URL ne rend pas le JSON attendu (un routeur d'application ` +
                    `hôte peut rendre son propre document en HTTP 200 sur ce chemin). Si la ` +
                    `configuration est déjà en mémoire, la remettre par ` +
                    `GeoLeaf.boot({ config }) supprime cette requête.`
            );
            throw err;
        });
};

C.loadActiveProfileResources = function (
    options: { headers?: Record<string, string>; strictContentType?: boolean } = {}
): Promise<GeoLeafConfig> {
    const Profile = ProfileManager;
    if (!Profile) {
        Log.error("[GeoLeaf.Config] Profile module not available.");
        return Promise.reject(new Error("Profile module not available"));
    }
    return Profile.loadActiveProfileResources(options);
};

export { Config };
