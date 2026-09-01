#!/usr/bin/env node
/**
 * PROBE — the two transports of `@geoleaf-plugins/position-share`, in a REAL browser.
 *
 * Automated as far as it can honestly be.
 * The 73 unit tests of the package run under happy-dom against mocked seams; NOTHING had ever
 * exercised this plugin inside a real Chromium, against the real bundle, driven by the real
 * geolocation capability. That gap is what this file closes.
 *
 * WHY A STANDALONE SCRIPT AND NOT `playwright test`: `playwright.config.js` starts four
 * http-servers, and starting a server is forbidden in a Claude Code session. The dev nginx
 * already serves `deploy/deploy-core` permanently. Same reasoning — and same shape — as
 * `scripts/probe-boot-contract.mjs`.
 *
 * ⚠️ RUN THE FOUR-STEP REGENERATION FIRST. This probe reads whatever nginx serves; against a
 * stale `deploy/` it would grade an old bundle and say nothing:
 *   npx turbo run build && npm run build:deploy
 *     && node scripts/build-deploy-coverage.cjs && npm run build:deploy:local
 *
 * ── WHAT IT PROVES, AND WHAT IT CANNOT ────────────────────────────────────────────────────
 *
 * Proved here: the real GPS watch feeds the plugin; the HTTP transport POSTs the documented
 * payload and sets no `Authorization` of its own; a rejected send DROPS the sample instead of
 * queueing it; the distance guard holds a stationary user off the wire; the WebSocket transport
 * names its failure causes and NEVER calls `Ws.init()`; the badge appears and leaves with the
 * loop; reception degrades cleanly when `realtime-layer` is absent.
 *
 * 🖐 NOT proved here, and it must not be claimed: the `connector` bearer token. The token is
 * injected by the connector plugin REPLACING `window.fetch`, and only when the endpoint shares
 * its `baseUrl` origin — reproducing that needs a configured connector and a real credential.
 * What this probe asserts is the half that is checkable without one: that the plugin adds no
 * competing `Authorization` header. The rest stays a manual step.
 *
 * Usage:  E2E_TARGET=nginx node scripts/probe-position-share.mjs
 *
 * ⚠️ `E2E_TARGET=nginx` is NOT optional here. `baseURL()` defaults to the `ports` target — the
 * http-servers `playwright.config.js` starts — and this probe must never start one. Without the
 * variable it dials `localhost:8766` and dies on `ERR_CONNECTION_REFUSED`.
 * `GEOLEAF_PROBE_URL` still wins, for probing an arbitrary deployment.
 *
 * Exit:   0 = all assertions passed · 1 = at least one failed
 *
 * ── SEEN RED BEFORE BEING BELIEVED ────────────────────────────────────────────────────────
 *
 * 20/08/2026: `ws.init?.()` was inserted into the WebSocket transport, the plugin rebuilt and
 * redeployed. The probe went red on "Ws connecté : init() n'est toujours pas appelé", and green
 * again once the file was restored (byte-for-byte, sha256 verified).
 *
 * 📌 The mutation also showed the two `init()` assertions are NOT redundant: the one in the
 * DISCONNECTED case stayed green, because the transport rejects before reaching that line. One
 * covers the error path, the other the nominal path — deleting either would leave a hole.
 */

import { chromium } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";
import { baseURL } from "../e2e/helpers/base-url.js";

const URL = process.env.GEOLEAF_PROBE_URL || `${baseURL("core")}/`;

/** Cross-origin on purpose: it is the shape an integrator's backend actually has. */
const ENDPOINT = "https://positions.probe.invalid/positions";

/** Where the simulated device sits, and where it moves to for the distance-guard case. */
const HERE = { latitude: -21.115, longitude: 55.536 };
const FAR = { latitude: -21.16, longitude: 55.536 }; // ~5 km south

/** `serviceWorkers: 'block'` makes register() resolve undefined → this log is a TEST ARTEFACT. */
const KNOWN_NOISE = [
    /\[SWRegister\] Registration failed/i,
    // Registering a module after init() is a property of EVERY lazy plugin in this repo
    // (six `entry.ts` do it), not of this one. Out of scope for this probe.
    /registered AFTER init\(\)/i,
];

const results = [];
const check = (name, ok, detail = "") => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !detail ? "" : `\n      → ${detail}`}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Opens the plugin's configuration and loads its bundle, inside the page.
 *
 * The profile ships `enabled: false` on purpose — a public demo that emitted its visitors'
 * position would be the very defect this plugin exists to avoid. So the probe overrides the
 * config seam rather than shipping an open profile.
 */
async function arm(page, overrides) {
    await page.evaluate(async (cfg) => {
        const gl = /** @type {any} */ (globalThis).GeoLeaf;
        if (!gl.__probeOrigGet) gl.__probeOrigGet = gl.Config.get.bind(gl.Config);
        gl.Config.get = (k, d) => (k === "modules.position-share" ? cfg : gl.__probeOrigGet(k, d));
        await gl.plugins.load("position-share");
    }, overrides);
}

/**
 * Switches the geolocation SEAM to a fixture, after section A has proved the real one works.
 *
 * 🛑 Measured, not assumed: driving the live watch through `context.setGeolocation()` mid-run
 * made Chromium raise a `GeolocationPositionError`, the watch died, `readFix()` returned null,
 * and SIX assertions went red at once — every transport case included, because a tick with no
 * fix never reaches a transport. Those reds said nothing about the plugin; they said the probe
 * had broken its own fixture.
 *
 * Section A keeps the real capability precisely because that is the part no unit test can
 * reach. Everything after it exercises BRANCHES, and a branch test that cannot control its
 * input is not a test — it is a coin toss. `getState()` is the seam the emitter reads, so
 * replacing it is the same surface, made deterministic.
 */
async function seamFix(page, pos) {
    await page.evaluate((p) => {
        const gl = /** @type {any} */ (globalThis).GeoLeaf;
        if (!gl.__probeOrigGeo) gl.__probeOrigGeo = gl.Geolocation;
        gl.Geolocation = {
            ...gl.__probeOrigGeo,
            getState: () => ({
                active: true,
                watchId: 1,
                userPosition: { lat: p.latitude, lng: p.longitude, timestamp: Date.now() },
            }),
        };
    }, pos);
}

const run = async () => {
    const browser = await chromium.launch({ args: SOFTWARE_GL_ARGS });
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        serviceWorkers: "block",
        permissions: ["geolocation"],
        geolocation: HERE,
    });
    const page = await context.newPage();

    // The intercepted backend. `posts` is the ledger every HTTP assertion reads, and
    // `httpStatus` is what section D flips to make the endpoint fail.
    const posts = [];
    let httpStatus = 200;

    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => {
        if (m.type() !== "error") return;
        const t = m.text();
        // The 503s of section D are CAUSED by this probe, on its own intercepted endpoint.
        // The exemption is scoped to the WINDOW where the probe forces them: excusing 503s
        // outside it would hide a real one, and an exemption that always applies is not an
        // exemption — it is a blind spot with a comment on top.
        if (httpStatus === 503 && /\b503\b/.test(t)) return;
        if (!KNOWN_NOISE.some((re) => re.test(t))) consoleErrors.push(t);
    });
    await page.route(ENDPOINT, async (route) => {
        const req = route.request();
        posts.push({
            method: req.method(),
            headers: req.headers(),
            body: (() => {
                try {
                    return JSON.parse(req.postData() || "null");
                } catch {
                    return null;
                }
            })(),
        });
        await route.fulfill({ status: httpStatus, body: "" });
    });

    console.log(`\n▸ ${URL}\n`);
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Same wait condition as the boot probe: profile layers painted AND the basemap source
    // present. `map.loaded()` alone flips true before the profile is in.
    await page.waitForFunction(
        () => {
            const native = /** @type {any} */ (
                globalThis
            ).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            const style = native?.getStyle?.();
            if (!style) return false;
            const layers = (style.layers || []).filter(
                (l) => l.id.startsWith("gl-") && l.id !== "gl-sentinel-poi"
            );
            return layers.length > 0 && !!(style.sources || {})["__geoleaf_basemap__"];
        },
        { timeout: 30000 }
    );

    // ── A — the REAL geolocation capability feeds the plugin ──────────────────────────────
    //
    // This is the one assertion a unit test cannot make. Everything below could be satisfied
    // by a mocked `getState()`; only this one shows the core's watch actually reaching the
    // emitter, through the seam, in a browser that granted a real permission.

    const hasControl = await page.locator(".geoleaf-ctrl-geolocation a").count();
    check("le contrôle de géolocalisation est dans le DOM", hasControl > 0);

    await arm(page, {
        enabled: true,
        mode: "manual",
        transport: "http",
        endpoint: ENDPOINT,
        intervalMs: 500,
        minDistanceM: 0,
        showButton: true,
        receive: { enabled: false },
    });

    check(
        "le namespace GeoLeaf.PositionShare est monté après chargement paresseux",
        await page.evaluate(
            () => typeof (/** @type {any} */ (globalThis).GeoLeaf?.PositionShare) === "object"
        )
    );

    // 🛑 A PROGRAMMATIC click, not `locator.click()`, and the difference is the point. The
    // control is in the DOM but NOT VISIBLE — the mobile toolbar owns the visible affordance.
    // Playwright refuses to click an invisible element; the plugin calls `link.click()`
    // directly, which works. Driving it any other way would test a path the plugin never takes.
    if (hasControl > 0) {
        await page.evaluate(() =>
            /** @type {any} */ (document.querySelector(".geoleaf-ctrl-geolocation a"))?.click()
        );
    }

    const watchOn = await page
        .waitForFunction(
            () =>
                /** @type {any} */ (globalThis).GeoLeaf?.Geolocation?.getState?.().active === true,
            {
                timeout: 15000,
            }
        )
        .then(() => true)
        .catch(() => false);
    check("la veille GPS du core devient active après le clic", watchOn);

    const fix = await page.evaluate(
        () => /** @type {any} */ (globalThis).GeoLeaf.Geolocation.getState().userPosition
    );
    check(
        "la capacité expose la position simulée par le navigateur",
        !!fix && Math.abs(fix.lat - HERE.latitude) < 0.01,
        JSON.stringify(fix)
    );

    // ── B — the HTTP transport, and its payload ───────────────────────────────────────────
    //
    // From here on the fix comes from the seam, and the live watch is turned OFF first so no
    // background `watchPosition` can raise an error the assertions would then have to excuse.

    if (hasControl > 0) {
        await page.evaluate(() =>
            /** @type {any} */ (document.querySelector(".geoleaf-ctrl-geolocation a"))?.click()
        );
    }
    await seamFix(page, HERE);

    await page.evaluate(() => /** @type {any} */ (globalThis).GeoLeaf.PositionShare.start());
    await sleep(1200);

    check("un POST atteint l'endpoint configuré", posts.length > 0, `${posts.length} requête(s)`);

    const first = posts[0];
    check(
        "la charge porte clientId / lat / lng / timestamp",
        !!first?.body &&
            typeof first.body.clientId === "string" &&
            typeof first.body.lat === "number" &&
            typeof first.body.lng === "number" &&
            typeof first.body.timestamp === "number",
        JSON.stringify(first?.body)
    );
    check(
        "clientId porte le préfixe `loc:` des identifiants locaux",
        typeof first?.body?.clientId === "string" && first.body.clientId.startsWith("loc:"),
        first?.body?.clientId
    );
    check(
        "la position émise est celle du navigateur",
        !!first?.body && Math.abs(first.body.lat - HERE.latitude) < 0.01
    );
    check("la méthode est POST", first?.method === "POST");

    // 🖐 The plugin sets NO Authorization. The connector owns the token by replacing `fetch`;
    // a header here would be a second, competing source of truth. What this asserts is the
    // absence — the presence of a REAL token needs a configured connector (see the header).
    check(
        "le plugin ne pose aucun en-tête Authorization de son cru",
        !Object.keys(first?.headers || {}).some((h) => h.toLowerCase() === "authorization"),
        Object.keys(first?.headers || {}).join(", ")
    );

    // ── C — the distance guard ────────────────────────────────────────────────────────────

    await page.evaluate(() => /** @type {any} */ (globalThis).GeoLeaf.PositionShare.stop());
    posts.length = 0;
    await arm(page, {
        enabled: true,
        mode: "manual",
        transport: "http",
        endpoint: ENDPOINT,
        intervalMs: 300,
        minDistanceM: 50,
        showButton: true,
        receive: { enabled: false },
    });
    await page.evaluate(() => /** @type {any} */ (globalThis).GeoLeaf.PositionShare.start());
    await sleep(1500); // ~5 cycles, device stationary

    check(
        "immobile : le premier point part, les suivants sont retenus",
        posts.length === 1,
        `${posts.length} requête(s) sur ~5 cycles`
    );

    await seamFix(page, FAR);
    await sleep(1200);
    check(
        "après un déplacement au-delà du seuil, l'émission reprend",
        posts.length > 1,
        `${posts.length} requête(s)`
    );

    // ── D — a rejected send drops the sample, it does not queue it ────────────────────────

    await page.evaluate(() => /** @type {any} */ (globalThis).GeoLeaf.PositionShare.stop());
    await seamFix(page, HERE);
    posts.length = 0;
    httpStatus = 503;
    await arm(page, {
        enabled: true,
        mode: "manual",
        transport: "http",
        endpoint: ENDPOINT,
        intervalMs: 300,
        minDistanceM: 0,
        showButton: true,
        receive: { enabled: false },
    });
    await page.evaluate(() => /** @type {any} */ (globalThis).GeoLeaf.PositionShare.start());
    await sleep(1500);
    const during = posts.length;
    httpStatus = 200;
    await sleep(900);
    const after = posts.length;

    check(
        "un endpoint en échec ne fait PAS accumuler de points",
        after - during <= 4 && during > 0,
        `${during} pendant l'échec, ${after - during} après rétablissement`
    );
    check(
        "la boucle survit à des rejets répétés",
        await page.evaluate(
            () => /** @type {any} */ (globalThis).GeoLeaf.PositionShare.isEmitting() === true
        )
    );

    // ── E — the emission badge ────────────────────────────────────────────────────────────

    check(
        "la pastille d'émission est visible pendant l'émission",
        (await page.locator(".gl-position-share-badge").count()) === 1
    );
    check(
        "la pastille annonce son état aux technologies d'assistance",
        (await page.locator('.gl-position-share-badge[role="status"]').count()) === 1
    );

    await page.evaluate(() => /** @type {any} */ (globalThis).GeoLeaf.PositionShare.stop());
    check(
        "la pastille disparaît à l'arrêt",
        (await page.locator(".gl-position-share-badge").count()) === 0
    );

    // ── F — the WebSocket transport ───────────────────────────────────────────────────────
    //
    // Three states, three named outcomes. The plugin must NEVER call `Ws.init()`: the
    // connection belongs to the integrator and may already serve realtime layers, and `init`
    // destroys before it rebuilds.

    const wsAbsent = await page.evaluate(async () => {
        const gl = /** @type {any} */ (globalThis).GeoLeaf;
        delete gl.Ws;
        gl.Config.get = (k, d) =>
            k === "modules.position-share"
                ? {
                      enabled: true,
                      mode: "manual",
                      transport: "websocket",
                      channel: "positions",
                      intervalMs: 300,
                      minDistanceM: 0,
                      showButton: true,
                      receive: { enabled: false },
                  }
                : gl.__probeOrigGet(k, d);
        const errs = [];
        const origWarn = gl.Log.warn;
        gl.Log.warn = (...a) => errs.push(a.map(String).join(" "));
        gl.PositionShare.start();
        await new Promise((r) => setTimeout(r, 700));
        gl.PositionShare.stop();
        gl.Log.warn = origWarn;
        return errs.join(" | ");
    });
    check(
        "Ws absent : l'erreur nomme la cause et le geste",
        /GeoLeaf\.Ws is absent/i.test(wsAbsent),
        wsAbsent.slice(0, 160)
    );

    const wsState = await page.evaluate(async () => {
        const gl = /** @type {any} */ (globalThis).GeoLeaf;
        const calls = { init: 0, sent: [] };
        gl.Ws = {
            state: "disconnected",
            init: () => {
                calls.init++;
            },
            send: (c, p) => calls.sent.push([c, p]),
        };
        const errs = [];
        const origWarn = gl.Log.warn;
        gl.Log.warn = (...a) => errs.push(a.map(String).join(" "));
        gl.PositionShare.start();
        await new Promise((r) => setTimeout(r, 700));
        gl.PositionShare.stop();
        gl.Log.warn = origWarn;
        return { msg: errs.join(" | "), calls };
    });
    check(
        "Ws non connecté : l'erreur nomme l'état et le geste",
        /disconnected/i.test(wsState.msg),
        wsState.msg.slice(0, 160)
    );
    check(
        "Ws non connecté : rien n'est envoyé",
        wsState.calls.sent.length === 0,
        JSON.stringify(wsState.calls.sent).slice(0, 120)
    );
    check(
        "🛑 le plugin n'appelle JAMAIS Ws.init()",
        wsState.calls.init === 0,
        `init() appelé ${wsState.calls.init} fois`
    );

    const wsOk = await page.evaluate(async () => {
        const gl = /** @type {any} */ (globalThis).GeoLeaf;
        const calls = { init: 0, sent: [] };
        gl.Ws = {
            state: "connected",
            init: () => {
                calls.init++;
            },
            send: (c, p) => calls.sent.push([c, p]),
        };
        gl.PositionShare.start();
        await new Promise((r) => setTimeout(r, 700));
        gl.PositionShare.stop();
        return calls;
    });
    check(
        "Ws connecté : la trame part sur le canal configuré",
        wsOk.sent.length > 0 && wsOk.sent[0][0] === "positions",
        JSON.stringify(wsOk.sent[0] || null).slice(0, 160)
    );
    check(
        "Ws connecté : la charge est la même qu'en HTTP",
        !!wsOk.sent[0] &&
            typeof wsOk.sent[0][1]?.clientId === "string" &&
            typeof wsOk.sent[0][1]?.lat === "number"
    );
    check("Ws connecté : init() n'est toujours pas appelé", wsOk.init === 0);

    // ── G — reception degrades cleanly when realtime-layer is absent ──────────────────────

    const recv = await page.evaluate(() => {
        const gl = /** @type {any} */ (globalThis).GeoLeaf;
        delete gl.RealtimeLayer;
        gl.Config.get = (k, d) =>
            k === "modules.position-share"
                ? {
                      enabled: true,
                      mode: "manual",
                      transport: "http",
                      endpoint: "https://positions.probe.invalid/positions",
                      intervalMs: 300,
                      minDistanceM: 0,
                      showButton: true,
                      receive: { enabled: true, layerId: "fleet" },
                  }
                : gl.__probeOrigGet(k, d);
        return {
            shown: gl.PositionShare.showOthers(true),
            stillEmits: gl.PositionShare.start(),
        };
    });
    check("realtime-layer absent : showOthers rend false sans jeter", recv.shown === false);
    check(
        "realtime-layer absent : l'émission fonctionne quand même",
        recv.stillEmits === true,
        "l'émission ne dépend pas de la réception"
    );
    await page.evaluate(() => /** @type {any} */ (globalThis).GeoLeaf.PositionShare.stop());

    // ── H — the open registry ─────────────────────────────────────────────────────────────

    const transports = await page.evaluate(() => {
        const gl = /** @type {any} */ (globalThis).GeoLeaf;
        gl.PositionShare.registerTransport("probe-custom", () => ({ send: async () => {} }));
        return gl.PositionShare.listTransports();
    });
    check(
        "les deux transports intégrés sont enregistrés",
        transports.includes("http") && transports.includes("websocket"),
        transports.join(", ")
    );
    check(
        "un transport tiers cohabite avec eux",
        transports.includes("probe-custom"),
        transports.join(", ")
    );

    // ── I — no loud regression ────────────────────────────────────────────────────────────

    check(
        "0 erreur JS pendant toute la sonde",
        pageErrors.length === 0 && consoleErrors.length === 0,
        [...pageErrors, ...consoleErrors].slice(0, 3).join(" | ")
    );

    await browser.close();

    const failed = results.filter((r) => !r.ok);
    console.log(
        `\n${failed.length === 0 ? "✅" : "❌"} ${results.length - failed.length}/${results.length} assertions\n`
    );
    if (failed.length === 0) {
        console.log(
            "🖐 Reste MANUEL : le jeton du connector (injecté en remplaçant `fetch`, et seulement\n" +
                "   si l'endpoint partage l'origine de `connector.baseUrl`) — il demande un connector\n" +
                "   configuré et une vraie authentification.\n"
        );
    }
    return failed.length === 0 ? 0 : 1;
};

run().then(
    (code) => process.exit(code),
    (err) => {
        console.error("\n❌ Sonde en erreur :", err?.message || err);
        process.exit(1);
    }
);
