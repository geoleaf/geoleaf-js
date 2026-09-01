/*!
 * @geoleaf-plugins/realtime-layer
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * PollingSource — fetches a URL at a fixed interval and notifies handlers.
 *
 * - GeoJSON responses: forwarded as parsed JSON objects.
 * - Binary responses (GTFS-RT protobuf): forwarded as `ArrayBuffer`.
 * - Page visibility: polling is suspended when the tab is hidden and
 *   resumed when it becomes visible, avoiding unnecessary requests.
 * - Fallback URL: when provided, the source fetches it once per outage
 *   window (primary non-2xx or network error) and automatically returns
 *   to the primary URL on the first successful tick.
 */

import type { IRealtimeSource } from "./i-realtime-source.js";

/**
 * Fetches a URL at a fixed interval and forwards each response to the handlers.
 *
 * The fallback transport: it needs nothing of the server beyond an HTTP endpoint, at the cost
 * of a latency bounded by the interval and of traffic that continues whether or not anything
 * changed. Prefer {@link SseSource} or {@link WebSocketSource} where the server supports them.
 */
export class PollingSource implements IRealtimeSource {
    private readonly _url: string;
    private readonly _intervalMs: number;
    private readonly _decoder: string;
    private readonly _fallbackUrl: string | undefined;

    private _handler: ((data: unknown) => void) | null = null;
    private _timerId: ReturnType<typeof setInterval> | null = null;
    private _visibilityHandler: (() => void) | null = null;
    /**
     * Tracks whether the fallback snapshot has already been emitted for the
     * current outage window, to avoid re-emitting the same static payload on
     * every tick while the primary URL stays down. Reset on the first
     * successful primary fetch.
     */
    private _fallbackServed = false;

    /**
     * Cancellation of in-flight requests, carried by THIS source's lifecycle.
     *
     * 🛑 `stop()` did `clearInterval` + `removeEventListener` and **nothing
     * else**. It closed the front door — no more ticks, no more wake-ups on
     * `visibilitychange` — but not the request **already gone**: its
     * continuation calls `this._handler` back, which pushes data into a layer
     * the caller just stopped.
     *
     * 🛑 ONE CONTROLLER PER INSTANCE, AND THAT IS THE DIFFERENCE WITH
     * `legend.ts`. There the lifecycle owner is the **module** (one
     * controller, aborted by `_reset()`). Here it is the **instance**: two
     * `PollingSource`s on two different layers stop independently, and one
     * must not cancel the other's requests. The pattern is the same — *one
     * controller per lifecycle owner* — the owner is what changes.
     *
     * ⚠️ Recreated at first need after each `stop()`: an aborted
     * `AbortController` is aborted **for life**, so reusing it would fail any
     * request of a later `start()` outright — and `start()` after `stop()` is
     * a NORMAL cycle here (resume on `visibilitychange`).
     */
    private _controller: AbortController | null = null;

    constructor(url: string, intervalMs: number, decoder: string, fallbackUrl?: string) {
        this._url = url;
        this._intervalMs = intervalMs;
        this._decoder = decoder;
        this._fallbackUrl = fallbackUrl;
    }

    onData(handler: (data: unknown) => void): void {
        this._handler = handler;
    }

    start(): void {
        if (this._timerId !== null) return;
        // Fetch immediately on start, then on each interval
        void this._fetch();
        this._timerId = setInterval(() => {
            if (document.visibilityState === "hidden") return;
            void this._fetch();
        }, this._intervalMs);

        // Suspend/resume on tab visibility change
        this._visibilityHandler = () => {
            if (document.visibilityState === "visible") {
                void this._fetch();
            }
        };
        document.addEventListener("visibilitychange", this._visibilityHandler);
    }

    stop(): void {
        if (this._timerId !== null) {
            clearInterval(this._timerId);
            this._timerId = null;
        }
        if (this._visibilityHandler) {
            document.removeEventListener("visibilitychange", this._visibilityHandler);
            this._visibilityHandler = null;
        }
        // The request already gone: the one `clearInterval` could not reach.
        if (this._controller) {
            this._controller.abort();
            this._controller = null;
        }
    }

    private async _fetch(): Promise<void> {
        if (!this._handler) return;
        const primaryOk = await this._fetchOne(this._url, false);
        if (primaryOk) {
            this._fallbackServed = false;
            return;
        }
        if (this._fallbackUrl && !this._fallbackServed) {
            const fallbackOk = await this._fetchOne(this._fallbackUrl, true);
            if (fallbackOk) this._fallbackServed = true;
        }
    }

    /**
     * Fetch a single URL, decode the payload and forward it to the handler.
     *
     * @returns `true` when the fetch returned 2xx and the handler was invoked.
     */
    private async _fetchOne(url: string, isFallback: boolean): Promise<boolean> {
        const tag = isFallback ? "[fallback]" : "";
        if (typeof AbortController === "function") {
            this._controller ??= new AbortController();
        }
        const signal = this._controller?.signal;
        try {
            const resp = await fetch(url, signal ? { signal } : undefined);
            if (!resp.ok) {
                console.warn(`[realtime-layer][polling]${tag} ${url} — HTTP ${resp.status}`);
                return false;
            }
            const data: unknown =
                this._decoder === "gtfs-rt" ? await resp.arrayBuffer() : await resp.json();
            // 🛑 SECOND GUARD, AND IT IS NOT REDUNDANT WITH THE SIGNAL. Between
            // the response and this line there are TWO `await`s — reading the
            // body is itself asynchronous. `stop()` can land in that gap, and
            // `abort()` can no longer do anything: the request is done.
            // Without this test, `this._handler` would push data into a
            // stopped layer. ⚠️ Testing `this._handler` is NOT enough —
            // `stop()` does not reset it to `null`, and nulling it would break
            // the `stop()` → `start()` cycle.
            if (signal?.aborted) return false;
            this._handler!(data);
            if (isFallback) {
                console.info(`[realtime-layer][polling] using fallback snapshot ${url}`);
            }
            return true;
        } catch (err) {
            // A cancellation is not a transport error: logging it as one
            // would surface a warning at every normal `stop()`.
            if ((err as Error | undefined)?.name === "AbortError") return false;
            console.warn(`[realtime-layer][polling]${tag} fetch error for ${url}:`, err);
            return false;
        }
    }
}
