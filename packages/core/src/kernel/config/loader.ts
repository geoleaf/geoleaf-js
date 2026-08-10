/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import { Security } from "../security/index.js";
import type { LoadUrlOptions } from "./geoleaf-config/config-types.js";

let _cachedSecurity: typeof Security | null = null;
function _getSecurity(): typeof Security | null {
    if (_cachedSecurity !== null) return _cachedSecurity;
    _cachedSecurity = Security ?? null;
    return _cachedSecurity;
}

function _validateUrl(url: string): string | Error {
    const Security = _getSecurity();
    const isRelative = /^\.{0,2}\//.test(url) || /^\/[^/]/.test(url);
    if (isRelative) return url;
    if (Security && typeof Security.validateUrl === "function") {
        try {
            return Security.validateUrl(url);
        } catch (e) {
            return new Error(
                "[GeoLeaf.Config.Loader] " + (e instanceof Error ? e.message : String(e))
            );
        }
    }
    if (!/^https?:\/\//i.test(url))
        return new Error(
            "[GeoLeaf.Config.Loader] URL doit \u00eatre relative ou commencer par http:// ou https://"
        );
    return url;
}

function _checkContentType(
    contentType: string | null,
    strictContentType: boolean,
    ctx: string
): Error | null {
    if (strictContentType && (!contentType || !contentType.includes("application/json"))) {
        return new Error(
            "[GeoLeaf.Config.Loader] Content-Type invalide" +
                ctx +
                ": expected 'application/json', re\u00e7u '" +
                (contentType || "null") +
                "'."
        );
    }
    if (!strictContentType && contentType && !contentType.includes("application/json"))
        Log.warn("[GeoLeaf.Config.Loader] Unexpected Content-Type:", contentType);
    return null;
}

function _doFetch(
    url: string,
    hdrs: Record<string, string>,
    strictContentType: boolean,
    ctx: string
): Promise<Record<string, unknown>> {
    return fetch(url, { method: "GET", headers: { Accept: "application/json", ...hdrs } })
        .then((response) => {
            if (!response.ok) throw new Error("HTTP " + response.status + " pour " + url);
            const ctErr = _checkContentType(
                response.headers.get("content-type"),
                strictContentType,
                ctx
            );
            if (ctErr) throw ctErr;
            return response.json().catch((parseErr: Error) => {
                throw new Error(
                    "[GeoLeaf.Config.Loader] Erreur de parsing JSON pour " +
                        url +
                        ": " +
                        parseErr.message
                );
            });
        })
        .then((json: unknown) => {
            if (typeof json !== "object" || json === null)
                throw new Error("Le JSON de configuration n'est pas un object valide.");
            return json as Record<string, unknown>;
        });
}

/**
 * Module Config.Loader
 *
 * Responsibilities:
 * - HTTP loading through fetch(), with CSRF/XSS validation
 * - Validation Content-Type stricte
 * - Custom header handling
 * - Helper generic _fetchJson()
 */
const LoaderModule = {
    /**
     * Fetch a JSON configuration file from a validated URL.
     * @param url - Absolute or relative URL of the JSON resource.
     * @param options - Optional fetch options (headers, strictContentType). Defaults to `{}`.
     * @returns The parsed JSON record, or an empty object `{}` if the URL is missing.
     */
    loadUrl(url: string, options: LoadUrlOptions = {}): Promise<Record<string, unknown>> {
        if (!url) {
            Log.warn("[GeoLeaf.Config.Loader] Missing JSON URL in loadUrl().");
            return Promise.resolve({});
        }
        const { headers = {}, strictContentType = true } = options;
        const validUrl = _validateUrl(url);
        if (validUrl instanceof Error) {
            Log.error(validUrl.message);
            return Promise.reject(validUrl);
        }
        return _doFetch(validUrl, headers as Record<string, string>, strictContentType, "").catch(
            (err: Error) => {
                Log.error("[GeoLeaf.Config.Loader] Error loading JSON:", err);
                throw err;
            }
        );
    },

    /**
     * Fetch a JSON resource from a validated URL, returning null instead of throwing on empty.
     * @param url - Absolute or relative URL of the JSON resource.
     * @param options - Optional fetch options (headers, strictContentType). Defaults to `{}`.
     * @returns The parsed JSON record, or null if the URL is missing or the resource cannot be parsed.
     */
    fetchJson(url: string, options: LoadUrlOptions = {}): Promise<Record<string, unknown> | null> {
        if (!url) {
            Log.warn("[GeoLeaf.Config.Loader] fetchJson() called without URL.");
            return Promise.resolve(null);
        }
        const { headers = {}, strictContentType = true } = options;
        const validUrl = _validateUrl(url);
        if (validUrl instanceof Error) {
            Log.error(validUrl.message);
            return Promise.reject(validUrl);
        }
        return _doFetch(
            validUrl,
            headers as Record<string, string>,
            strictContentType,
            " dans fetchJson"
        )
            .then((json) => json as Record<string, unknown> | null)
            .catch((err: Error) => {
                Log.error("[GeoLeaf.Config.Loader] Error in fetchJson() for " + url + ":", err);
                throw err;
            });
    },
};

// Named `ConfigLoader`, not `ProfileLoader`: this module is a JSON-over-HTTP fetcher
// (loadUrl / fetchJson), and the real profile loader lives in profile-loader.ts. Under the
// old name every single production importer had to alias it (`ProfileLoader as ConfigLoader`),
// and profile-loader.ts ended up exporting `ProfileLoader` while importing `ProfileLoader`.
// The global key has always been `GeoLeaf._ConfigLoader` — the export now agrees with it.
const ConfigLoader = LoaderModule;
export { ConfigLoader };
