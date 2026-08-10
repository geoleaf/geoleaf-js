/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview RetryHandler - Manages retry logic with exponential backoff
 * Extracted from downloader.js for better modularity
 *
 * @version 3.0.0
 * @phase Phase 1 - Priority 1 Critical Refactoring
 */
"use strict";

import { Log } from "../../../utils/log/index.js";

/** Default attempt budget: one initial try plus two retries. */
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Configuration accepted by {@link RetryHandler.init}.
 *
 * ⚠️ `maxAttempts` counts TOTAL attempts, not retries: `3` means one initial try
 * followed by two retries. That has always been the loop's semantics — the option
 * used to be spelled `maxRetries`, which said the opposite and made `0` (the
 * obvious spelling of "do not retry") skip the operation entirely.
 */
interface RetryConfig {
    /** Total attempts allowed, initial try included. Values below 1 are floored to 1. */
    maxAttempts?: number;
    /**
     * @deprecated Misnomer kept so existing profile configs keep working — it never
     * meant "retries". Use {@link RetryConfig.maxAttempts}; this is normalised into it
     * by {@link RetryHandler.init} and never stored.
     */
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffMultiplier?: number;
}

/** Normalised configuration as actually held by the handler (single source of truth). */
type NormalizedRetryConfig = Omit<RetryConfig, "maxRetries">;

interface RetryOptions {
    signal?: AbortSignal;
    /** Per-call override of the total attempt budget. Values below 1 are floored to 1. */
    maxAttempts?: number;
    /** @deprecated Use {@link RetryOptions.maxAttempts}. */
    maxRetries?: number;
    resourceName?: string;
}

/**
 * Folds the deprecated `maxRetries` spelling into `maxAttempts` and drops it, so the
 * stored config never carries two keys claiming the same budget.
 */
function _normalizeConfig(config: RetryConfig): NormalizedRetryConfig {
    const { maxRetries, ...rest } = config;
    const maxAttempts = rest.maxAttempts ?? maxRetries;
    return maxAttempts === undefined ? rest : { ...rest, maxAttempts };
}

/**
 * RetryHandler - Handles download retries with exponential backoff
 *
 * Features:
 * - Exponential backoff strategy
 * - Configurable max retries
 * - Abort signal support
 * - Detailed error logging
 *
 * @namespace GeoLeaf.Storage.Cache.RetryHandler
 */
const RetryHandler = {
    _config: {
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        initialDelay: 1000,
        maxDelay: 5000,
        backoffMultiplier: 2,
    } as NormalizedRetryConfig,

    init(config: RetryConfig = {}) {
        this._config = { ...this._config, ..._normalizeConfig(config) };
        Log.debug("[RetryHandler] Initialized:", this._config);
    },

    /**
     * Execute operation with retry logic
     *
     * @param {Function} operation - Async operation to execute
     * @param {Object} [options={}] - Retry options
     * @param {AbortSignal} [options.signal] - Abort signal
     * @param {number} [options.maxAttempts] - Override the TOTAL attempt budget
     * @param {string} [options.resourceName] - Resource name for logging
     * @returns {Promise<*>} Operation result
     * @throws {Error} If every attempt fails
     *
     * @example
     * // 5 attempts = 1 initial try + 4 retries.
     * const result = await RetryHandler.retry(
     *   async () => await fetch(url),
     *   { maxAttempts: 5, resourceName: 'icon.svg' }
     * );
     */
    async retry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
        const requested =
            options.maxAttempts ??
            options.maxRetries ??
            this._config.maxAttempts ??
            DEFAULT_MAX_ATTEMPTS;
        // Floor at 1: a budget of 0 (or a negative one) used to make the loop body
        // unreachable, so the operation was never invoked and this function rejected
        // with the untouched `lastError` — i.e. `undefined`. Reporting a failure for
        // work that was never attempted is worse than attempting it once.
        const maxAttempts = Math.max(1, Math.floor(requested));
        const resourceName = options.resourceName ?? "resource";
        let lastError: unknown;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Check abort signal before attempt
                if (options.signal?.aborted) {
                    throw new Error("Aborted");
                }

                // Execute operation
                const result = await operation();

                if (attempt > 1) {
                    Log.info(
                        `[RetryHandler] ✓ ${resourceName} succeeded on attempt ${attempt}/${maxAttempts}`
                    );
                }

                return result;
            } catch (error: unknown) {
                lastError = error;
                const err = error as Error & { name?: string };

                // Don't retry on abort
                if (err?.name === "AbortError" || err?.message === "Aborted") {
                    Log.debug(`[RetryHandler] Aborted ${resourceName}`);
                    throw error;
                }

                // Log retry attempt
                Log.debug(
                    `[RetryHandler] Attempt ${attempt}/${maxAttempts} failed for ${resourceName}: ${err?.message ?? error}`
                );

                // If not last attempt, wait before retry
                if (attempt < maxAttempts) {
                    const delay = this._calculateDelay(attempt);
                    Log.debug(`[RetryHandler] Retrying ${resourceName} in ${delay}ms...`);
                    await this._sleep(delay, options?.signal);
                }
            }
        }

        // All retries failed
        Log.error(
            `[RetryHandler] ✗ ${resourceName} failed after ${maxAttempts} attempts:`,
            lastError
        );
        throw lastError;
    },

    _calculateDelay(attempt: number): number {
        const initial = this._config.initialDelay ?? 1000;
        const mult = this._config.backoffMultiplier ?? 2;
        const maxD = this._config.maxDelay ?? 5000;
        const delay = initial * Math.pow(mult, attempt - 1);
        return Math.min(delay, maxD);
    },

    /**
     * Sleep with abort support
     *
     * ⚠️ The abort listener is removed on BOTH exits, not just on abort.
     * `{ once: true }` only self-removes when the event actually fires, and the
     * happy path here is precisely the one where it never does. The signal is not
     * per-sleep: `downloader.ts` builds ONE `AbortController` per profile and hands
     * its signal to every `retry()` of every resource, so a listener left behind by
     * a resolved timer is a listener held for the whole download — on a profile that
     * can enumerate tens of thousands of tiles (CAPACITÉS backlog B.35a).
     *
     * @private
     * @param {number} ms - Milliseconds to sleep
     * @param {AbortSignal} [signal] - Abort signal
     * @returns {Promise<void>}
     * Rejects with an `Error("Aborted")` when the signal fires — before the wait as well as
     * during it. ⚠️ No `@throws` tag: the failure is a promise **rejection**, not a literal
     * `throw`, and TSD-03 requires the tag to sit above one. For an `await`er the two are
     * indistinguishable; for the gate they are not.
     */
    async _sleep(ms: number, signal?: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(new Error("Aborted"));
                return;
            }

            let abortHandler: (() => void) | null = null;
            const release = () => {
                if (abortHandler && signal) {
                    signal.removeEventListener("abort", abortHandler);
                    abortHandler = null;
                }
            };

            const timeout = setTimeout(() => {
                release();
                resolve();
            }, ms);

            if (signal) {
                abortHandler = () => {
                    clearTimeout(timeout);
                    release();
                    reject(new Error("Aborted"));
                };
                signal.addEventListener("abort", abortHandler, { once: true });
            }
        });
    },

    /**
     * Get current configuration
     * @returns {Object} Current configuration
     */
    getConfig(): RetryConfig {
        return { ...this._config };
    },
};

export { RetryHandler };
