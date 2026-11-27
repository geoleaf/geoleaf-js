/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Offline – keeping the code of the plugins loaded on demand.
 *
 * A zone prepared for offline use is written into IndexedDB. A plugin loaded on demand is an
 * `import()`, which the service worker serves from its static cache — never from IndexedDB —
 * and which only entered that cache the first time it was loaded online. A user who had not
 * opened the editor before leaving had a prepared zone and an editor button that did nothing.
 *
 * The preparation therefore asks the worker to keep those files (`PRECACHE_LAZY_PLUGINS`). The
 * worker holds their list, derived at build time from the deployed `init.js`: the page never
 * spells a content-hashed name.
 */

import { Log } from "../../../utils/log/index.js";

/**
 * What the worker reports: `cached`, the files kept, whether fetched now or already there;
 * `failed`, the files it could not fetch. Module-private — callers read it off the summary.
 */
interface PluginCodeReport {
    readonly cached: number;
    readonly failed: readonly string[];
}

/**
 * Upper bound on the wait. The worker fetches a few files one by one; past this, the
 * preparation reports what it knows rather than holding the user's window open.
 */
const ANSWER_TIMEOUT_MS = 30_000;

/**
 * Asks the controlling service worker to keep the plugins loaded on demand.
 *
 * Never throws: a page without a worker (a host that does not register one, a private window)
 * has nothing to ask, and the zone is still prepared. A failure is logged with what it costs.
 *
 * @returns The worker's report, or `null` when no worker answered.
 */
export async function keepPluginCode(): Promise<PluginCodeReport | null> {
    const controller =
        typeof navigator !== "undefined" ? navigator.serviceWorker?.controller : undefined;
    if (!controller || typeof MessageChannel === "undefined") return null;

    const channel = new MessageChannel();
    const answer = new Promise<PluginCodeReport | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), ANSWER_TIMEOUT_MS);
        channel.port1.onmessage = (event: MessageEvent) => {
            clearTimeout(timer);
            resolve(event.data as PluginCodeReport);
        };
    });
    controller.postMessage({ type: "PRECACHE_LAZY_PLUGINS" }, [channel.port2]);
    const report = await answer;
    channel.port1.close();

    if (!report) {
        Log.warn("[Offline] The service worker did not report on the plugins' code.");
    } else if (report.failed.length > 0) {
        Log.warn(
            `[Offline] ${report.failed.length} plugin file(s) not kept — those plugins will not ` +
                `open offline: ${report.failed.join(", ")}`
        );
    }
    return report;
}
