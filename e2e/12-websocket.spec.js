// @ts-check
// E2E: 12-websocket — @geoleaf-plugins/websocket on deploy-core (port 8766).
//
// ⚠️ Ce bloc a dit « EAGER-loaded by deploy-core's index.html » jusqu'au 07/08/2026 : socle-init
// S4.5 a retiré la balise. `websocket` n'est préchargé que si le profil déclare un flux
// `source: "websocket"` ; `tourism` fait du polling, donc c'est le helper `boot()` qui le
// charge — comme le ferait l'application hôte qui s'en sert. init() n'est appelé par AUCUN
// profil (le config est passé en mémoire par le consommateur), donc tout le cycle de connexion
// est piloté depuis le test.
//
// WebSocket cannot be mocked at the network layer: Playwright's page.route() intercepts
// HTTP(S) only, never ws://. There is also no live broker in any deployment — and since
// 27/07/2026 there is no `source:"websocket"` profile at all.
//
// ⚠️ Requalifié le 27/07/2026 (B-42) : ce paragraphe citait `world-transport/ports` comme le
// seul profil déclarant `source:"websocket"` (inerte, `enabled:false`, pointant un endpoint
// externe que le plugin ne consomme pas — le constat S6 « inert websocket profile »). Ce
// profil a été retiré avec les 5 autres démos. **Cette spec n'en dépendait pas** : elle ne
// charge aucun profil et pilote tout depuis un faux WebSocket. B-42 la comptait parmi les
// specs cassées ; seul son commentaire l'était. Le constat reste vrai a fortiori — il n'y a
// plus aucun broker à joindre.
//
// So we inject a controllable fake window.WebSocket
// via addInitScript BEFORE navigation: the built-in "native-ws" transport then drives the
// fake deterministically. This mirrors S5's simulated EventSource and S4's page-driven flow.
//
// Validates CDC_plugin-websocket.md v1.1.0: §2.1 connection lifecycle, §2.2 backoff
// reconnection, §2.4 offline send-queue + flush, §2.5 metrics, the realtime-layer coupling
// (source:"websocket" -> GeoLeaf.Ws.subscribe), and the geoleaf:ws:* event surface.
//
// Finding consigned (asserted negatively in test 3): the CDC lists a geoleaf:ws:message
// event, but emitMessage is dead code (never called) — channel messages are delivered ONLY
// through the subscribe(channel, handler) callback, not via a document event.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

// serviceWorkers:'block' — deploy-core ships a PWA SW; without blocking it the page can be
// served stale and our addInitScript-injected globals race the SW-controlled bundle (piège
// S4/S5). Blocking the SW makes the harness authoritative.
test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

// wss:// — the fake ignores the scheme (no real TLS), and wss:// sidesteps the plugin's
// "ws:// rejected in production" validation rule entirely.
const WS_URL = "wss://e2e.geoleaf.test/ws";

/**
 * Installs, before any page script runs:
 *   1. window.__wsEvents — a recorder for every geoleaf:ws:* document event.
 *   2. window.WebSocket — a controllable fake exposing test hooks on window.__ws.last:
 *        .__emit(obj)        deliver an inbound message  (onmessage)
 *        .__drop(code,reason) simulate a server-side drop (onclose, post-connect)
 *        .sent[]             outbound frames captured from transport.send()
 *      Each new instance auto-opens on a macrotask (so init()/reconnect() resolve), and
 *      auto-replies pong to {type:"ping"} so heartbeat (when enabled) stays satisfied.
 */
function installHarness(page) {
    return page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__wsEvents = [];
        const EV = [
            "connected",
            "disconnected",
            "reconnecting",
            "failed",
            "auth-required",
            "message",
            "channel-subscribed",
            "channel-unsubscribed",
            "send-queued",
            "send-dropped",
            "send-queued-overflow",
            "heartbeat-timeout",
            "metrics-updated",
        ];
        EV.forEach((n) =>
            document.addEventListener("geoleaf:ws:" + n, (e) => {
                w.__wsEvents.push({ name: n, detail: /** @type {any} */ (e).detail });
            })
        );

        const ctrl = (w.__ws = { instances: [], last: null });
        class FakeWS {
            constructor(url) {
                this.url = url;
                this.readyState = 0; // CONNECTING
                this.sent = [];
                this.onopen = null;
                this.onclose = null;
                this.onerror = null;
                this.onmessage = null;
                ctrl.instances.push(this);
                ctrl.last = this;
                setTimeout(() => {
                    if (this.readyState === 0) {
                        this.readyState = 1; // OPEN
                        if (this.onopen) this.onopen({});
                    }
                }, 0);
            }
            send(data) {
                this.sent.push(data);
                try {
                    const m = JSON.parse(data);
                    if (m && m.type === "ping") {
                        setTimeout(() => {
                            if (this.onmessage)
                                this.onmessage({ data: JSON.stringify({ type: "pong" }) });
                        }, 0);
                    }
                } catch {
                    /* non-JSON frame — ignore */
                }
            }
            close(code, reason) {
                if (this.readyState === 3) return;
                this.readyState = 3; // CLOSED
                if (this.onclose)
                    this.onclose({ code: code == null ? 1000 : code, reason: reason || "" });
            }
            // ── test hooks ──
            __emit(obj) {
                if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) });
            }
            __drop(code, reason) {
                if (this.readyState === 3) return;
                this.readyState = 3;
                if (this.onclose)
                    this.onclose({
                        code: code == null ? 1006 : code,
                        reason: reason || "server-drop",
                    });
            }
        }
        FakeWS.CONNECTING = 0;
        FakeWS.OPEN = 1;
        FakeWS.CLOSING = 2;
        FakeWS.CLOSED = 3;
        w.WebSocket = /** @type {any} */ (FakeWS);
    });
}

/** Boot deploy-core with the harness installed; returns the collected pageerror messages. */
async function boot(page) {
    await installHarness(page);
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
    // socle-init S4.5 — `websocket` n'est plus eager. Il n'est préchargé par le hook
    // `beforeBoot` d'`init.js` QUE si le profil déclare un flux `source: "websocket"` ;
    // `tourism` fait du polling, donc rien ne le charge ici. C'est voulu : 4,3 Ko gz pour
    // zéro appelant seraient 4,3 Ko de trop. Cette suite pilote l'API à la main, elle le
    // demande donc à la main — comme le ferait l'application hôte qui s'en sert.
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("websocket"));
    await page.waitForFunction(() => !!(/** @type {any} */ (window).GeoLeaf?.Ws), null, {
        timeout: 10000,
    });
    return errors;
}

/** init() the plugin and wait until connected. */
async function initConnected(page, reconnect) {
    await page.evaluate(
        ({ url, rc }) =>
            /** @type {any} */ (window).GeoLeaf.Ws.init({
                transport: "native-ws",
                url,
                reconnect: rc,
            }),
        { url: WS_URL, rc: reconnect || { initialDelayMs: 50, maxRetries: 5 } }
    );
    await page.waitForFunction(
        () => /** @type {any} */ (window).GeoLeaf.Ws.state === "connected",
        null,
        {
            timeout: 30000,
        }
    );
}

test.describe("12-websocket", () => {
    test("boot: GeoLeaf.Ws exposed, disconnected before init, no ws console error", async ({
        page,
    }) => {
        const errors = await boot(page);
        const state = await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Ws.state);
        expect(state).toBe("disconnected");

        const api = await page.evaluate(() => {
            const ws = /** @type {any} */ (window).GeoLeaf.Ws;
            return [
                "init",
                "destroy",
                "reconnect",
                "subscribe",
                "unsubscribe",
                "send",
                "getMetrics",
            ].every((m) => typeof ws[m] === "function");
        });
        expect(api).toBe(true);

        // getMetrics() is safe before init — returns a zeroed snapshot.
        const metrics = await page.evaluate(() =>
            /** @type {any} */ (window).GeoLeaf.Ws.getMetrics()
        );
        expect(metrics.connectedAt).toBeNull();
        expect(metrics.messagesSent).toBe(0);

        const wsErrors = errors.filter((m) => /websocket|geoleaf:ws|GeoLeaf\.Ws/i.test(m));
        expect(wsErrors).toEqual([]);
    });

    test('connect: init() reaches "connected" and emits geoleaf:ws:connected', async ({ page }) => {
        await boot(page);
        await initConnected(page);

        await page.waitForFunction(() =>
            /** @type {any} */ (window).__wsEvents.some((e) => e.name === "connected")
        );
        const detail = await page.evaluate(
            () => /** @type {any} */ (window).__wsEvents.find((e) => e.name === "connected").detail
        );
        expect(detail.transport).toBe("native-ws");

        const connectedAt = await page.evaluate(
            () => /** @type {any} */ (window).GeoLeaf.Ws.getMetrics().connectedAt
        );
        expect(connectedAt).not.toBeNull();
    });

    test("subscribe: inbound channel message reaches handler (delivery via callback, not event)", async ({
        page,
    }) => {
        await boot(page);
        await initConnected(page);

        await page.evaluate(() => {
            const w = /** @type {any} */ (window);
            w.__received = [];
            w.GeoLeaf.Ws.subscribe("telemetry", (p) => w.__received.push(p));
        });
        // subscribe() emits channel-subscribed (this event IS wired)...
        await page.waitForFunction(() =>
            /** @type {any} */ (window).__wsEvents.some(
                (e) => e.name === "channel-subscribed" && e.detail.channel === "telemetry"
            )
        );

        await page.evaluate(() =>
            /** @type {any} */ (window).__ws.last.__emit({
                channel: "telemetry",
                payload: { v: 42 },
            })
        );
        await page.waitForFunction(() => /** @type {any} */ (window).__received.length > 0);
        const received = await page.evaluate(() => /** @type {any} */ (window).__received);
        expect(received[0]).toEqual({ v: 42 });

        // FINDING: geoleaf:ws:message is documented in the CDC but emitMessage is dead code —
        // it is never emitted. Delivery is callback-only. Assert the event did NOT fire.
        const msgEvent = await page.evaluate(() =>
            /** @type {any} */ (window).__wsEvents.some((e) => e.name === "message")
        );
        expect(msgEvent).toBe(false);
    });

    test("send + metrics: connected send reaches transport and increments messagesSent", async ({
        page,
    }) => {
        await boot(page);
        await initConnected(page);

        await page.evaluate(() =>
            /** @type {any} */ (window).GeoLeaf.Ws.send("cmd", { do: "ping" })
        );

        const sent = await page.evaluate(() => /** @type {any} */ (window).__ws.last.sent);
        const frames = sent.map((s) => JSON.parse(s)).filter((m) => m.channel === "cmd");
        expect(frames).toHaveLength(1);
        expect(frames[0].payload).toEqual({ do: "ping" });

        const messagesSent = await page.evaluate(
            () => /** @type {any} */ (window).GeoLeaf.Ws.getMetrics().messagesSent
        );
        expect(messagesSent).toBe(1);

        // metrics-updated is wired and fires across lifecycle transitions.
        const metricsEvent = await page.evaluate(() =>
            /** @type {any} */ (window).__wsEvents.some((e) => e.name === "metrics-updated")
        );
        expect(metricsEvent).toBe(true);
    });

    test("reconnect backoff: server drop -> disconnected -> reconnecting -> reconnected", async ({
        page,
    }) => {
        await boot(page);
        await initConnected(page, { initialDelayMs: 80, maxDelayMs: 300, maxRetries: 5 });

        // Simulate a post-connect server drop (close code 1006).
        await page.evaluate(() => /** @type {any} */ (window).__ws.last.__drop());

        // disconnected + reconnecting(attempt 1) should fire synchronously on the drop.
        await page.waitForFunction(() => {
            const ev = /** @type {any} */ (window).__wsEvents;
            return (
                ev.some((e) => e.name === "disconnected") &&
                ev.some((e) => e.name === "reconnecting")
            );
        });
        const reconnecting = await page.evaluate(
            () =>
                /** @type {any} */ (window).__wsEvents.find((e) => e.name === "reconnecting").detail
        );
        expect(reconnecting.attempt).toBe(1);
        expect(reconnecting.nextDelayMs).toBeGreaterThan(0);

        // Backoff timer fires -> a fresh socket auto-opens -> back to connected.
        await page.waitForFunction(
            () => /** @type {any} */ (window).GeoLeaf.Ws.state === "connected",
            null,
            {
                timeout: 30000,
            }
        );
        const reconnectCount = await page.evaluate(
            () => /** @type {any} */ (window).GeoLeaf.Ws.getMetrics().reconnectCount
        );
        expect(reconnectCount).toBeGreaterThanOrEqual(1);
    });

    test("offline queue: sends while reconnecting are queued (FIFO) and flushed on reconnect", async ({
        page,
    }) => {
        await boot(page);
        // Long backoff so the disconnected window is observable before auto-reconnect.
        await initConnected(page, { initialDelayMs: 600, maxDelayMs: 600, maxRetries: 5 });

        // Drop; state becomes "reconnecting" synchronously, then send two messages -> queued.
        await page.evaluate(() => {
            const w = /** @type {any} */ (window);
            w.__ws.last.__drop();
            w.GeoLeaf.Ws.send("q", { n: 1 });
            w.GeoLeaf.Ws.send("q", { n: 2 });
        });

        const state = await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Ws.state);
        expect(state).toBe("reconnecting");

        // send-queued events carry the authoritative queue length (1 then 2).
        const queuedLengths = await page.evaluate(() =>
            /** @type {any} */ (window).__wsEvents
                .filter((e) => e.name === "send-queued")
                .map((e) => e.detail.queueLength)
        );
        expect(queuedLengths).toEqual([1, 2]);

        // Capture how many frames the OLD socket got (should be none of the queued sends).
        const oldSocketIndex = await page.evaluate(
            () => /** @type {any} */ (window).__ws.instances.length - 1
        );

        // Backoff fires -> new socket opens -> resubscribe + flush in FIFO order.
        await page.waitForFunction(
            () => /** @type {any} */ (window).GeoLeaf.Ws.state === "connected",
            null,
            {
                timeout: 30000,
            }
        );
        const flushed = await page.evaluate((idx) => {
            const w = /** @type {any} */ (window);
            // The flush targets the newest (reconnected) socket, after the dropped one.
            const newSocket = w.__ws.instances[idx + 1] || w.__ws.last;
            return newSocket.sent.map((s) => JSON.parse(s)).filter((m) => m.channel === "q");
        }, oldSocketIndex);
        expect(flushed.map((m) => m.payload)).toEqual([{ n: 1 }, { n: 2 }]);
    });

    test("coupling: realtime-layer pattern (GeoLeaf.Ws.subscribe) delivers a FeatureCollection", async ({
        page,
    }) => {
        await boot(page);

        // Prérequis de couplage. ⚠️ Les deux plugins ne sont plus eager (S4.5) et arrivent
        // par des chemins DIFFÉRENTS : `websocket` par le `plugins.load` de `boot()`,
        // `realtime-layer` par le préchargement `beforeBoot` d'`init.js` (le profil `tourism`
        // déclare `data.realtime.enabled`). Cette assertion vaut donc aussi contrôle du
        // préchargement : si le hook cessait de voir le profil, elle rougirait ici.
        const bothPresent = await page.evaluate(() => {
            const g = /** @type {any} */ (window).GeoLeaf;
            return !!g?.Ws && !!g?.RealtimeLayer;
        });
        expect(bothPresent).toBe(true);

        await initConnected(page);

        // Reproduce exactly what realtime-layer's websocket source does:
        //   GeoLeaf.Ws.subscribe(channel, (data) => handler(data))
        // and deliver a GeoJSON FeatureCollection on that channel.
        await page.evaluate(() => {
            const w = /** @type {any} */ (window);
            w.__rt = null;
            w.GeoLeaf.Ws.subscribe("ais.positions", (data) => {
                w.__rt = data;
            });
        });
        await page.evaluate(() => {
            const fc = {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        properties: { mmsi: "227123456" },
                        geometry: { type: "Point", coordinates: [1.1, 49.5] },
                    },
                ],
            };
            /** @type {any} */ (window).__ws.last.__emit({ channel: "ais.positions", payload: fc });
        });

        await page.waitForFunction(() => /** @type {any} */ (window).__rt !== null);
        const rt = await page.evaluate(() => /** @type {any} */ (window).__rt);
        expect(rt.type).toBe("FeatureCollection");
        expect(rt.features[0].properties.mmsi).toBe("227123456");
    });
});
