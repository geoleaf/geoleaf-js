/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview FetchHelper - Unified HTTP clinkt with timeout, retry, and cache strategies
 * @version 1.2.0
 */

import { Log } from "../log/index.js";
import { Security } from "../../kernel/security/index.js";

const FETCH_DEFAULTS = {
    timeout: 10000,
    retries: 2,
    retryDelay: 1000,
    retryDelayMultiplier: 1.5,
    maxPerDomain: 50,
    windowMs: 10000,
};

/**
 * ⚠ Doit rester EXPORTÉ : `FetchHelper.getConfig()` le retourne et `FetchHelper` est
 * ré-exposé par `utils-api.ts` (`GeoLeaf.Utils`). Le dé-exporter casse la déclaration
 * de `Utils` (TS4023 : « has or is using name … but cannot be named »). Le gate B3 le
 * verra orphelin — c'est un faux positif, il est nommé par une signature inférée.
 */
export interface FetchHelperOptions extends RequestInit {
    timeout?: number;
    retries?: number;
    retryDelay?: number;
    retryDelayMultiplier?: number;
    parseResponse?: boolean;
    throwOnError?: boolean;
    validateUrl?: boolean;
    /** @default "strict-origin-when-cross-origin" */
    referrerPolicy?: ReferrerPolicy;
    onRetry?: (attempt: number, error: Error, delay: number) => void;
    onTimeout?: (url: string, timeout: number, attempt: number) => void;
}

const DEFAULT_CONFIG: FetchHelperOptions = {
    timeout: FETCH_DEFAULTS.timeout,
    retries: FETCH_DEFAULTS.retries,
    retryDelay: FETCH_DEFAULTS.retryDelay,
    retryDelayMultiplier: FETCH_DEFAULTS.retryDelayMultiplier,
    cache: "default",
    credentials: "same-origin",
    referrerPolicy: "strict-origin-when-cross-origin",
    parseResponse: true,
    throwOnError: true,
    validateUrl: true,
};

const _rateLimiter = {
    _requests: new Map<string, number[]>(),
    maxPerDomain: FETCH_DEFAULTS.maxPerDomain,
    windowMs: FETCH_DEFAULTS.windowMs,

    allow(url: string): boolean {
        let domain: string;
        try {
            domain = new URL(
                url,
                (globalThis as { location?: { origin?: string } }).location?.origin ??
                    "https://localhost"
            ).hostname;
        } catch {
            domain = "_relative";
        }
        const now = Date.now();
        let timestamps = _rateLimiter._requests.get(domain) ?? [];
        timestamps = timestamps.filter((t) => now - t < _rateLimiter.windowMs);
        if (timestamps.length >= _rateLimiter.maxPerDomain) return false;
        timestamps.push(now);
        _rateLimiter._requests.set(domain, timestamps);
        return true;
    },

    reset(): void {
        _rateLimiter._requests.clear();
    },
};

/**
 * Error carrying the HTTP response that caused it.
 *
 * Distinct from a network failure: a `FetchError` means the request completed and the server
 * answered with a status the caller rejected, so `status` and the response are available.
 */
export class FetchError extends Error {
    url?: string;
    attempts?: number;
    type: string;
    override cause?: unknown;

    constructor(
        message: string,
        context: { url?: string; attempts?: number; type?: string; cause?: unknown } = {}
    ) {
        super(message);
        this.name = "FetchError";
        // Assign only when known: an absent `url`/`attempts` must stay ABSENT on the instance,
        // not present holding `undefined` — the two differ for `in` probes and for structured
        // serialisation of the error context.
        if (context.url !== undefined) this.url = context.url;
        if (context.attempts !== undefined) this.attempts = context.attempts;
        this.type = context.type ?? "unknown";
        this.cause = context.cause;
        if (
            typeof (Error as unknown as { captureStackTrace?: (obj: object, fn: Function) => void })
                .captureStackTrace === "function"
        ) {
            (
                Error as unknown as { captureStackTrace: (obj: object, fn: Function) => void }
            ).captureStackTrace(this, FetchError);
        }
    }
}

function _validateAndResolveUrl(url: string, config: FetchHelperOptions): string {
    if (config.validateUrl && Security?.validateUrl) {
        try {
            return Security.validateUrl(url);
        } catch (error) {
            throw new FetchError(`URL validation failed: ${(error as Error).message}`, {
                url,
                cause: error,
                type: "validation_error",
            });
        }
    }
    return url;
}

function _throwFinalRetryError(
    url: string,
    config: FetchHelperOptions,
    error: unknown,
    attempt: number
): never {
    throw new FetchError(
        `Request failed after ${(config.retries ?? FETCH_DEFAULTS.retries) + 1} attempts: ${(error as Error).message}`,
        {
            url,
            attempts: attempt,
            cause: error,
            type: (error as Error).name === "AbortError" ? "timeout" : "network_error",
        }
    );
}

async function _handleRetry(
    url: string,
    config: FetchHelperOptions,
    error: unknown,
    attempt: number
): Promise<void> {
    if (attempt > (config.retries ?? FETCH_DEFAULTS.retries)) {
        _throwFinalRetryError(url, config, error, attempt);
    }
    const delay =
        (config.retryDelay ?? FETCH_DEFAULTS.retryDelay) *
        Math.pow(config.retryDelayMultiplier ?? FETCH_DEFAULTS.retryDelayMultiplier, attempt - 1);
    if (config.onRetry && typeof config.onRetry === "function") {
        try {
            config.onRetry(attempt, error as Error, delay);
        } catch (callbackError) {
            Log.warn("[FetchHelper] onRetry callback failed:", callbackError);
        }
    }
    const retries = config.retries ?? FETCH_DEFAULTS.retries;
    if (Log)
        Log.warn(
            `[FetchHelper] Retry ${attempt}/${retries} for ${url} in ${delay}ms (${(error as Error).message})`
        );
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
}

/**
 * Fetch wrapper adding timeouts, typed errors and JSON handling.
 *
 * Throws {@link FetchError} on a non-OK status instead of returning a response the caller must
 * remember to check — the default `fetch` behaviour being the usual source of silently
 * ignored 404s.
 */
export const FetchHelper = {
    async fetch(url: string, options: FetchHelperOptions = {}): Promise<Response | unknown> {
        const config = { ...DEFAULT_CONFIG, ...options };
        let attempt = 0;

        if (!_rateLimiter.allow(url)) {
            throw new FetchError("Rate limit exceeded for this domain", {
                url,
                type: "rate_limit_error",
            });
        }

        const resolvedUrl = _validateAndResolveUrl(url, config);
        const maxRetries = config.retries ?? FETCH_DEFAULTS.retries;
        while (attempt <= maxRetries) {
            try {
                const result = await this._executeRequest(resolvedUrl, config, attempt);
                if (Log && attempt > 0)
                    Log.info(`[FetchHelper] ✓ ${resolvedUrl} (succeeded after ${attempt} retries)`);
                return result;
            } catch (error) {
                attempt++;
                await _handleRetry(resolvedUrl, config, error, attempt);
            }
        }

        throw new FetchError("Unreachable");
    },

    async _executeRequest(
        url: string,
        config: FetchHelperOptions,
        attempt: number
    ): Promise<Response | unknown> {
        const timeoutMs = config.timeout ?? FETCH_DEFAULTS.timeout;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            if (config.onTimeout && typeof config.onTimeout === "function") {
                try {
                    config.onTimeout(url, timeoutMs, attempt);
                } catch (e) {
                    Log.warn("[FetchHelper] onTimeout callback failed:", e);
                }
            }
        }, timeoutMs);

        try {
            const fetchOptions: RequestInit = { ...config };
            delete (fetchOptions as FetchHelperOptions).timeout;
            delete (fetchOptions as FetchHelperOptions).retries;
            delete (fetchOptions as FetchHelperOptions).retryDelay;
            delete (fetchOptions as FetchHelperOptions).retryDelayMultiplier;
            delete (fetchOptions as FetchHelperOptions).parseResponse;
            delete (fetchOptions as FetchHelperOptions).throwOnError;
            delete (fetchOptions as FetchHelperOptions).validateUrl;
            delete (fetchOptions as FetchHelperOptions).onRetry;
            delete (fetchOptions as FetchHelperOptions).onTimeout;
            fetchOptions.signal = controller.signal;

            const response = await fetch(url, fetchOptions);
            clearTimeout(timeoutId);

            if (!response.ok && config.throwOnError) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            if (config.parseResponse && response.ok) return await this._parseResponse(response);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            if ((error as Error).name === "AbortError") {
                throw new Error(`Request timed out after ${timeoutMs}ms`, { cause: error });
            }
            throw error;
        }
    },

    async _parseResponse(response: Response): Promise<unknown> {
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) return await response.json();
        if (contentType.includes("text/") || contentType.includes("application/javascript"))
            return await response.text();
        if (contentType.startsWith("image/") || contentType.includes("application/octet-stream"))
            return await response.blob();
        return await response.text();
    },

    async _delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    },

    async get(url: string, options: FetchHelperOptions = {}): Promise<Response | unknown> {
        return this.fetch(url, { ...options, method: "GET" });
    },

    async post(
        url: string,
        data: unknown,
        options: FetchHelperOptions = {}
    ): Promise<Response | unknown> {
        return this.fetch(url, {
            ...options,
            method: "POST",
            headers: { "Content-Type": "application/json", ...options.headers },
            body: typeof data === "string" ? data : JSON.stringify(data),
        });
    },

    async head(url: string, options: FetchHelperOptions = {}): Promise<Response> {
        return this.fetch(url, {
            ...options,
            method: "HEAD",
            parseResponse: false,
        }) as Promise<Response>;
    },

    async exists(url: string, options: FetchHelperOptions = {}): Promise<boolean> {
        try {
            const response = await this.head(url, { ...options, throwOnError: false });
            return response.ok;
        } catch (error) {
            Log.debug(`[FetchHelper] exists() failed for ${url}:`, (error as Error).message);
            return false;
        }
    },

    configure(config: Partial<FetchHelperOptions>): void {
        Object.assign(DEFAULT_CONFIG, config);
        Log.debug("[FetchHelper] Configuration updated:", DEFAULT_CONFIG);
    },

    getConfig(): FetchHelperOptions {
        return { ...DEFAULT_CONFIG };
    },

    get _rateLimiter(): typeof _rateLimiter {
        return _rateLimiter;
    },
};
