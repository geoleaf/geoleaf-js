// @ts-check
// Offline primitives — cutting the network, and PROVING nothing went out on it.
//
// WHY THIS EXISTS. Before 02/08/2026 exactly one spec in the suite cut the network
// (`09-editor.spec.js`) and it asserted a `window.__edQueued` flag, never the data. That is
// how the offline defects of Sprint 3 stayed alive: an event fires just as happily when the
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
 * Exécute `fn` et ÉCHOUE si le moindre appel réseau a été tenté, en NOMMANT les coupables.
 *
 * C'est l'instrument du critère de preuve n° 3. Il nomme les URLs parce qu'un simple
 * décompte dit que le scénario est cassé sans dire où regarder.
 *
 * 🛑 LE SCOPER, TOUJOURS — un appel non scopé sur une page de carte NE PEUT PAS passer au
 * vert. Mesuré : même après `settleNetwork`, les tuiles raster du fond continuent d'arriver.
 * Une carte vivante ne cesse jamais de parler au réseau, donc « zéro requête » n'est jamais
 * qu'un énoncé sur un PÉRIMÈTRE. Passer `allow` en nommant ce qui est du bruit de fond.
 *
 * ⚠️ Il n'y a délibérément AUCUNE liste d'exclusion par défaut : elle excuserait en silence
 * le trafic qu'un futur scénario doit précisément attraper.
 *
 * ⚠️ Et appeler `settleNetwork` d'abord, dans tous les cas : le seul trafic de boot compte
 * ~47 URLs distinctes.
 *
 * 🛑 CE QU'IL COMPTE EXACTEMENT : des INITIATIONS de requête, PAS de la sortie réseau.
 * Mesuré le 02/08/2026 — un `fetch()` servi ENTIÈREMENT par le Service Worker depuis
 * IndexedDB, sans que le moindre octet parte sur le fil, émet quand même un événement
 * `request`. Une assertion « zéro requête » posée autour d'un tel appel rougit donc sur la
 * réponse qu'on vient de servir localement.
 *
 * ✅ LA LIMITE A ÉTÉ INSTRUITE le 03/08/2026, avant d'écrire le scénario du critère 3
 * (`e2e/29-offline-proof.spec.js`), enregistreur ouvert et SANS assertion. Trois faits :
 *
 *   1. **Elle ne concerne que les LECTURES que le worker intercepte.** Le geste du critère 3
 *      est une mise en FILE : deux mises en file hors ligne produisent **0** événement, ni
 *      page ni worker. _(Mesuré sur `addToSyncQueue`, retiré à la tâche 4.11 ; le geste passe
 *      par `Storage.applyEdit` et le fait mesuré ne change pas.)_ Aucun discriminateur n'a donc eu à être construit — en écrire un « au
 *      cas où » aurait été du code sans objet.
 *   2. **`request.serviceWorker()` DISCRIMINE, le jour où il le faudra.** Sur une lecture que
 *      le worker relaie, l'enregistreur voit DEUX événements pour une seule URL : celui de la
 *      page (`serviceWorker() === null`) et celui du worker. Une requête portant un worker est
 *      une preuve SUFFISANTE que le fil a été sollicité — le `fetch` du worker n'est pas
 *      ré-interceptable. C'est ce que `Response.fromServiceWorker()` ne sait pas dire.
 *   3. **Le trafic de boot se calme en ~2 s**, pas en 300 ms : `settleNetwork` avant toute
 *      assertion de zéro n'est pas une précaution, c'est la condition. Vu rouge en le retirant.
 *
 * ⚠️ ET UN PIÈGE PAYÉ AU PASSAGE : l'instruction a d'abord été jouée sur la variante `full`,
 * où la carte s'était calmée, d'où la conclusion « zéro requête tout court ». Appliquée telle
 * quelle sur `addpoi`, l'assertion a rendu **28 URL** — les tuiles du fond continuent d'arriver
 * bien après le calme. **Mesurer sur une variante et conclure sur une autre** est la même faute
 * que recopier un chiffre. Le périmètre se dérive de l'origine, il ne se devine pas.
 *
 * ⚠️ Un jumeau `expectZeroNetwork` a existé quelques heures, avec le MÊME corps et un contrat
 * de retour différent. Retiré à la clôture de S3a — deux fonctions pour un rôle, c'est le
 * compteur C4, et aucune des deux n'avait de consommateur.
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
