/*!
 * @geoleaf-plugins/position-share — HTTP transport
 *
 * POSTs one sample to the configured endpoint, using the shared wire primitives of
 * `@geoleaf/host-runtime`. It sets no `Authorization` header of its own: the `connector` plugin
 * replaces `fetch` and injects the bearer, so a header here would be a second, competing source
 * of truth for the token.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { fetchWithTimeout, jsonHeaders, HttpFetchError } from "@geoleaf/host-runtime";

import type { PluginConfig } from "../config.js";
import type { IPositionTransport, PositionPayload } from "./contract.js";

/** Wall-clock budget for one POST. Beyond it the sample is stale anyway. */
const TIMEOUT_MS = 10000;

/**
 * Builds the built-in HTTP transport: one `POST` of the sample to `cfg.endpoint`.
 *
 * It sets NO `Authorization` header, and that is not an omission. The `connector` plugin
 * replaces `window.fetch` and injects the bearer itself — but **only when the endpoint shares
 * the origin of `connector.baseUrl`**. Point this transport at another origin and the request
 * leaves unauthenticated, silently. Setting a header here would not fix that; it would give a
 * second, competing source of truth for the token.
 *
 * @param cfg - The merged plugin configuration; `cfg.endpoint` must be set.
 * @returns A transport whose `send` rejects on any non-2xx or transport failure.
 */
export function createHttpTransport(cfg: PluginConfig): IPositionTransport {
    return {
        async send(payload: PositionPayload): Promise<void> {
            const endpoint = cfg.endpoint;
            if (!endpoint) {
                throw new Error(
                    'position-share: modules.position-share.endpoint is required when transport is "http"'
                );
            }

            // `globalThis.fetch` is read at call time, never captured: the `connector` plugin
            // swaps it during boot, and a reference taken at module load would keep pointing
            // at the original — losing the token without a word.
            const res = await fetchWithTimeout(
                globalThis.fetch,
                endpoint,
                {
                    method: "POST",
                    headers: jsonHeaders(),
                    body: JSON.stringify(payload),
                },
                TIMEOUT_MS
            );

            if (!res.ok) {
                throw new HttpFetchError(
                    "network",
                    `position-share: endpoint answered ${res.status} ${res.statusText}`
                );
            }
        },
    };
}
