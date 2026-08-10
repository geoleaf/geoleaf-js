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
        try {
            const resp = await fetch(url);
            if (!resp.ok) {
                console.warn(`[realtime-layer][polling]${tag} ${url} — HTTP ${resp.status}`);
                return false;
            }
            const data: unknown =
                this._decoder === "gtfs-rt" ? await resp.arrayBuffer() : await resp.json();
            this._handler!(data);
            if (isFallback) {
                console.info(`[realtime-layer][polling] using fallback snapshot ${url}`);
            }
            return true;
        } catch (err) {
            console.warn(`[realtime-layer][polling]${tag} fetch error for ${url}:`, err);
            return false;
        }
    }
}
