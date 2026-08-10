/*!
 * @geoleaf-plugins/realtime-layer
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * SseSource — consumes an SSE (`text/event-stream`) endpoint using the native
 * `EventSource` browser API and notifies handlers for each incoming `message`
 * event.
 *
 * The raw event data string is forwarded as-is to the registered handler;
 * the decoder (usually `JsonDecoder`) is responsible for parsing it.
 */

import type { IRealtimeSource } from "./i-realtime-source.js";

/**
 * Consumes a `text/event-stream` endpoint through the browser's native `EventSource`.
 *
 * Server-push without the bidirectionality of a socket — the right choice when updates only
 * ever flow server → client. Reconnection is handled by `EventSource` itself, which is why
 * this source carries no retry logic of its own.
 */
export class SseSource implements IRealtimeSource {
    private readonly _url: string;

    private _handler: ((data: unknown) => void) | null = null;
    private _es: EventSource | null = null;

    constructor(url: string) {
        this._url = url;
    }

    onData(handler: (data: unknown) => void): void {
        this._handler = handler;
    }

    start(): void {
        if (this._es) return;
        if (typeof EventSource === "undefined") {
            console.error(
                `[realtime-layer][sse] EventSource is not available in this environment. ` +
                    `Cannot open SSE connection to ${this._url}.`
            );
            return;
        }
        const es = new EventSource(this._url);
        this._es = es;

        es.onmessage = (ev: MessageEvent) => {
            if (this._handler) this._handler(ev.data);
        };

        es.onerror = () => {
            console.warn(
                `[realtime-layer][sse] Connection error for ${this._url}. ` +
                    `EventSource will attempt to reconnect automatically.`
            );
        };
    }

    stop(): void {
        if (this._es) {
            this._es.close();
            this._es = null;
        }
    }
}
