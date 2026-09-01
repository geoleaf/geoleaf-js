/**
 * Unit tests — Events public facade (GeoLeaf.events)
 */

import { Events } from "../../src/api/geoleaf.events.js";
import { Log } from "../../src/utils/log/index.js";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("GeoLeaf.events facade", () => {
    // EV-01: on() registers listener; handler receives CustomEvent with typed detail
    it("EV-01: on() registers a listener that receives the dispatched event detail", () => {
        const received = [];
        const handler = (e) => received.push(e.detail);

        Events.on("geoleaf:poi:click", handler);

        document.dispatchEvent(
            new CustomEvent("geoleaf:poi:click", {
                detail: { poiId: "abc", layerId: "layer-0", source: "direct" },
            })
        );

        Events.off("geoleaf:poi:click", handler);

        expect(received).toHaveLength(1);
        expect(received[0].poiId).toBe("abc");
        expect(received[0].source).toBe("direct");
    });

    // EV-02: off() removes the listener — no further calls after removal
    it("EV-02: off() removes the listener so subsequent events are not received", () => {
        const calls = [];
        const handler = (e) => calls.push(e.detail);

        Events.on("geoleaf:filter:apply", handler);
        Events.off("geoleaf:filter:apply", handler);

        document.dispatchEvent(
            new CustomEvent("geoleaf:filter:apply", {
                detail: { layerIds: ["l1"], activeCount: 3 },
            })
        );

        expect(calls).toHaveLength(0);
    });

    // EV-03: once() fires exactly once then removes itself
    it("EV-03: once() fires exactly once; subsequent events are ignored", () => {
        const calls = [];
        const handler = (e) => calls.push(e.detail);

        Events.once("geoleaf:layer:toggle", handler);

        const payload = { layerId: "lyr", visible: true, source: "user" };
        document.dispatchEvent(new CustomEvent("geoleaf:layer:toggle", { detail: payload }));
        document.dispatchEvent(new CustomEvent("geoleaf:layer:toggle", { detail: payload }));

        expect(calls).toHaveLength(1);
    });
    // ── An out-of-domain name subscribes INTO THE VOID, and said so silently ───────
    describe("avertissement sur un nom hors du domaine `geoleaf:`", () => {
        beforeEach(() => {
            Log.warn.mockClear();
        });

        it("avertit, et NOMME le nom qu'on voulait probablement écrire", () => {
            // 🛑 The real case: downstream writes
            // `GL.events.on("popup:action", …)` for a channel enriched
            // expressly for it. `on()` does not prefix — the subscription
            // will never fire, and the DOM accepts the string without flinching.
            const handler = () => {};
            Events.on("popup:action", handler);
            Events.off("popup:action", handler);

            expect(Log.warn).toHaveBeenCalled();
            const message = Log.warn.mock.calls[0][0];
            expect(message).toContain("popup:action");
            // The suggestion is the useful half: without it, the warning says
            // there is a problem without saying which of the two names is right.
            expect(message).toContain("geoleaf:popup:action");
        });

        it("N'avertit PAS sur un nom du domaine", () => {
            // ⚠️ Indispensable counter-proof: without it, a warning set on ALL
            // calls would pass the case above while drowning the console in
            // false positives.
            //
            // 🛑 THE NAME MUST BE UNSEEN IN THIS FILE, and this case was
            // caught out before being so. It used `geoleaf:poi:click` —
            // already through `on()` in EV-01, hence already in the
            // module-level dedup `Set`. The "warn on EVERYTHING, domain
            // included" mutation left it GREEN: it did not measure the
            // warning's absence, it measured the dedup. Module state shared
            // between cases turns a counter-proof into a tautology.
            const handler = () => {};
            Events.on("geoleaf:b240:jamais-vu-ailleurs", handler);
            Events.off("geoleaf:b240:jamais-vu-ailleurs", handler);

            expect(Log.warn).not.toHaveBeenCalled();
        });

        it("n'avertit QU'UNE FOIS par nom, quel que soit le nombre d'appels", () => {
            // An integrator subscribing in a render loop would drown their
            // console, and a drowned console warns nobody any more.
            const handler = () => {};
            Events.on("table:selectionChanged", handler);
            Events.on("table:selectionChanged", handler);
            Events.once("table:selectionChanged", handler);
            Events.off("table:selectionChanged", handler);

            expect(Log.warn).toHaveBeenCalledTimes(1);
        });

        it("avertit sur `off` et `once` aussi, pas seulement sur `on`", () => {
            // A misnamed `off()` removes nothing: the handler stays attached
            // forever. Silence there costs a leak, not only a dead subscription.
            const handler = () => {};
            Events.off("table:row:dblclick", handler);
            expect(Log.warn).toHaveBeenCalledTimes(1);

            Log.warn.mockClear();
            Events.once("map:somethingElse", handler);
            expect(Log.warn).toHaveBeenCalledTimes(1);
        });

        it("🛑 l'abonnement hors domaine est RÉELLEMENT mort — l'avertissement ne ment pas", () => {
            // ⚠️ Without this case, the previous ones would prove that a
            // warning fires, never that it tells the TRUTH. The
            // self-referential oracle: a test whose oracle would be its own
            // log assertion.
            const calls = [];
            Events.on("selectionChanged", () => calls.push(1));

            document.dispatchEvent(new CustomEvent("geoleaf:selectionChanged"));

            expect(calls).toHaveLength(0);
        });
    });
});
