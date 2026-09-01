// @ts-check
// Offline primitives — cutting the network, and PROVING nothing went out on it.
//
// WHY THIS EXISTS. Before 02/08/2026 exactly one spec in the suite cut the network
// (`09-editor.spec.js`) and it asserted a `window.__edQueued` flag, never the data. That is
// how the early offline defects stayed alive: an event fires just as happily when the
// payload it carries is empty. These primitives exist so a scenario can assert the ABSENCE
// of network traffic and the PRESENCE of stored bytes, which is what the sprint's proof
// criteria actually demand.
//
// 🛑 TWO TRAPS THIS FILE IS BUILT AROUND, both measured:
//
// 1. REQUESTS ARE RECORDED ON THE CONTEXT, NOT THE PAGE. A fetch issued by the Service
//    Worker never reaches `page.on("request")` — it is reported on the BrowserContext.
//    Counting page-level events only would report "zero requests" while the SW was happily
//    talking to the network, which is the exact false green criterion 3 exists to forbid.
//    Measured with `scripts/probe-sw-observability.mjs`: 43 requests seen context-side,
//    `sw-core.js` among them.
//
// 2. A CUT REQUEST STILL COUNTS. Under `setOffline(true)` an attempted request surfaces as
//    `requestfailed` (`net::ERR_INTERNET_DISCONNECTED`). Recording only successful requests
//    would score a path that *did* reach for the network as clean. Both events are recorded.
//
// ⚠️ `navigator.onLine` IS THE ONLY SIGNAL AVAILABLE. `modules.pwa.offlineDetector.enabled`
// is `false` in `profiles/geoleaf.config.json`, so `geoleaf:offline` / `geoleaf:online` are
// NOT emitted by the deployed app. Do not wait on them — they will never come.

/**
 * Resolves a Page or BrowserContext to the BrowserContext that observes ALL of its traffic,
 * including Service Worker requests. See trap 1 in the header.
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} target
 * @returns {import('@playwright/test').BrowserContext}
 */
function _asContext(target) {
    return typeof (/** @type {any} */ (target).context) === "function"
        ? /** @type {import('@playwright/test').Page} */ (target).context()
        : /** @type {import('@playwright/test').BrowserContext} */ (target);
}

/**
 * Cuts the network and waits until the page actually observes it.
 *
 * The wait is not ceremony: `setOffline` resolves as soon as the CDP command is acked, which
 * is before `navigator.onLine` has flipped in the renderer. Acting immediately after can
 * therefore run against a page that still believes it is online.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {import('@playwright/test').Page} page
 * @param {{ timeout?: number }} [opts]
 */
async function goOffline(context, page, opts = {}) {
    await context.setOffline(true);
    await page.waitForFunction(() => navigator.onLine === false, null, {
        timeout: opts.timeout ?? 5000,
    });
}

/**
 * Restores the network and waits until the page observes it.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {import('@playwright/test').Page} page
 * @param {{ timeout?: number }} [opts]
 */
async function goOnline(context, page, opts = {}) {
    await context.setOffline(false);
    await page.waitForFunction(() => navigator.onLine === true, null, {
        timeout: opts.timeout ?? 5000,
    });
}

/**
 * Runs `fn` with the network cut, and restores it whatever happens.
 *
 * ALWAYS prefer this over a bare `goOffline` / `goOnline` pair. A failing assertion between
 * the two leaves the context offline for every subsequent test in the file, and the
 * resulting cascade of failures points at the wrong scenario.
 *
 * @template T
 * @param {import('@playwright/test').BrowserContext} context
 * @param {import('@playwright/test').Page} page
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withOffline(context, page, fn) {
    await goOffline(context, page);
    try {
        return await fn();
    } finally {
        await goOnline(context, page);
    }
}

/**
 * Starts recording every network attempt made by the context — pages AND service workers,
 * successful AND failed.
 *
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} target
 * @param {{ filter?: (url: string) => boolean }} [opts] `filter` keeps only matching URLs.
 * @returns {{ urls: string[], entries: {url: string, phase: 'sent'|'failed', error?: string}[],
 *             count: () => number, stop: () => void }}
 *          Live objects, filled as traffic happens. Call `stop()` before asserting.
 */
function recordRequests(target, opts = {}) {
    const context = _asContext(target);
    const keep = opts.filter ?? (() => true);
    /** @type {{url: string, phase: 'sent'|'failed', error?: string}[]} */
    const entries = [];
    /** @type {string[]} */
    const urls = [];

    const onRequest = (/** @type {any} */ req) => {
        const url = req.url();
        if (!keep(url)) return;
        entries.push({ url, phase: "sent" });
        if (!urls.includes(url)) urls.push(url);
    };
    const onFailed = (/** @type {any} */ req) => {
        const url = req.url();
        if (!keep(url)) return;
        entries.push({ url, phase: "failed", error: req.failure()?.errorText ?? "?" });
        if (!urls.includes(url)) urls.push(url);
    };

    context.on("request", onRequest);
    context.on("requestfailed", onFailed);

    return {
        urls,
        entries,
        count: () => urls.length,
        stop: () => {
            context.off("request", onRequest);
            context.off("requestfailed", onFailed);
        },
    };
}

/**
 * Waits until the context has made no network attempt for `quietMs` in a row.
 *
 * 🛑 CALL THIS BEFORE ANY ZERO-NETWORK ASSERTION. A freshly navigated page keeps fetching
 * for seconds after `domcontentloaded` — layer styles, sprites, glyphs, tiles. Measured on
 * `demo.geoleaf.local.test`: a 300 ms window opened right after boot saw **47 distinct
 * URLs**, none of them related to the scenario. `assertZeroNetwork` over that window is red
 * every time, and the red says nothing about the code under test.
 *
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} target
 * @param {{ quietMs?: number, timeout?: number }} [opts]
 * @returns {Promise<void>} resolves on quiet; rejects if `timeout` elapses while still busy.
 */
async function settleNetwork(target, opts = {}) {
    const quietMs = opts.quietMs ?? 800;
    const timeout = opts.timeout ?? 30000;
    const context = _asContext(target);

    let last = Date.now();
    let seen = 0;
    const bump = () => {
        last = Date.now();
        seen++;
    };
    context.on("request", bump);
    context.on("requestfailed", bump);

    const started = Date.now();
    try {
        for (;;) {
            if (Date.now() - last >= quietMs) return;
            if (Date.now() - started > timeout) {
                throw new Error(
                    `le réseau ne s'est pas calmé en ${timeout} ms ` +
                        `(${seen} requêtes, dernière il y a ${Date.now() - last} ms)`
                );
            }
            await new Promise((r) => setTimeout(r, 100));
        }
    } finally {
        context.off("request", bump);
        context.off("requestfailed", bump);
    }
}

/**
 * Runs `fn` and FAILS if the slightest network call was attempted, NAMING
 * the culprits.
 *
 * The instrument of proof criterion no. 3. It names the URLs because a bare
 * count says the scenario is broken without saying where to look.
 *
 * 🛑 SCOPE IT, ALWAYS — an unscoped call on a map page CANNOT come out
 * green. Measured: even after `settleNetwork`, the basemap's raster tiles
 * keep arriving. A live map never stops talking to the network, so "zero
 * requests" is only ever a statement about a PERIMETER. Pass `allow` naming
 * what is background noise.
 *
 * ⚠️ There is deliberately NO default exclusion list: it would silently
 * excuse the very traffic a future scenario must catch.
 *
 * ⚠️ And call `settleNetwork` first, in every case: boot traffic alone
 * counts ~47 distinct URLs.
 *
 * 🛑 WHAT IT COUNTS EXACTLY: request INITIATIONS, NOT network egress.
 * Measured on 2026-08-02 — a `fetch()` served ENTIRELY by the Service
 * Worker from IndexedDB, without a single byte leaving on the wire, still
 * emits a `request` event. A "zero requests" assertion set around such a
 * call thus reddens on the very response just served locally.
 *
 * ✅ THE LIMIT WAS SCHOOLED on 2026-08-03, before writing criterion 3's
 * scenario (`e2e/29-offline-proof.spec.js`), recorder open and WITHOUT
 * assertions. Three facts:
 *
 *   1. **It only concerns the READS the worker intercepts.** Criterion 3's
 *      gesture is an ENQUEUE: two offline enqueues produce **0** events,
 *      neither page nor worker. _(Measured on `addToSyncQueue`, removed at
 *      the outbox port; the gesture goes through `Storage.applyEdit` and
 *      the measured fact does not change.)_ So no discriminator had to be
 *      built — writing one "just in case" would have been subject-less
 *      code.
 *   2. **`request.serviceWorker()` DISCRIMINATES, the day it is needed.**
 *      On a read the worker relays, the recorder sees TWO events for one
 *      URL: the page's (`serviceWorker() === null`) and the worker's. A
 *      request carrying a worker is SUFFICIENT proof the wire was
 *      solicited — the worker's `fetch` is not re-interceptable. That is
 *      what `Response.fromServiceWorker()` cannot say.
 *   3. **Boot traffic settles in ~2 s**, not 300 ms: `settleNetwork` before
 *      any zero assertion is not a precaution, it is the condition. Seen
 *      red by removing it.
 *
 * ⚠️ AND A TRAP PAID ALONG THE WAY: the schooling was first played on the
 * `full` variant, where the map had settled, hence the conclusion "zero
 * requests, period". Applied as-is to `addpoi`, the assertion returned
 * **28 URLs** — the basemap tiles keep arriving well after the calm.
 * **Measuring on one variant and concluding on another** is the same fault
 * as copying a number. The perimeter derives from the origin, it is not
 * guessed.
 *
 * ⚠️ A twin `expectZeroNetwork` existed for a few hours, with the SAME body
 * and a different return contract. Removed as soon as it was spotted — two
 * functions for one role, and neither had a consumer.
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} target
 * @param {() => Promise<unknown>} fn
 * @param {{ allow?: RegExp[] }} [opts]
 * @returns {Promise<void>} rejects with the offending URLs listed.
 */
async function assertZeroNetwork(target, fn, opts = {}) {
    const allow = opts.allow ?? [];
    const rec = recordRequests(target, {
        filter: (url) => !allow.some((re) => re.test(url)),
    });
    try {
        await fn();
    } finally {
        rec.stop();
    }
    if (rec.count() > 0) {
        const detail = rec.entries
            .slice(0, 10)
            .map(
                (e) =>
                    `  ${e.phase === "failed" ? "✗" : "→"} ${e.url}${e.error ? ` (${e.error})` : ""}`
            )
            .join("\n");
        throw new Error(
            `expected ZERO network traffic, saw ${rec.count()} distinct URL(s):\n${detail}\n` +
                `  ⚠️ "failed" still counts — the code reached for the network, the network was cut.`
        );
    }
}

export { goOffline, goOnline, withOffline, settleNetwork, recordRequests, assertZeroNetwork };
