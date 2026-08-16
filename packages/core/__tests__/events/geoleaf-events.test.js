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
    // ── B-240 — un nom hors du domaine s'abonne DANS LE VIDE, et le disait en silence ──────
    describe("B-240 — avertissement sur un nom hors du domaine `geoleaf:`", () => {
        beforeEach(() => {
            Log.warn.mockClear();
        });

        it("avertit, et NOMME le nom qu'on voulait probablement écrire", () => {
            // 🛑 Le cas réel : l'aval écrit `GL.events.on("popup:action", …)` pour un canal
            // enrichi exprès pour lui. `on()` ne préfixe pas — l'abonnement ne se déclenchera
            // jamais, et le DOM accepte la chaîne sans broncher.
            const handler = () => {};
            Events.on("popup:action", handler);
            Events.off("popup:action", handler);

            expect(Log.warn).toHaveBeenCalled();
            const message = Log.warn.mock.calls[0][0];
            expect(message).toContain("popup:action");
            // La suggestion est la moitié utile : sans elle, l'avertissement dit qu'il y a un
            // problème sans dire lequel des deux noms est le bon.
            expect(message).toContain("geoleaf:popup:action");
        });

        it("N'avertit PAS sur un nom du domaine", () => {
            // ⚠️ Contre-épreuve indispensable : sans elle, un avertissement posé sur TOUS les
            // appels passerait le cas ci-dessus en noyant la console de faux positifs.
            //
            // 🛑 LE NOM DOIT ÊTRE INÉDIT DANS CE FICHIER, et ce cas a été pris en défaut avant
            // de l'être. Il utilisait `geoleaf:poi:click` — déjà passé par `on()` en EV-01,
            // donc déjà dans le `Set` de déduplication au niveau module. La mutation « avertir
            // sur TOUT, domaine compris » l'a laissé VERT : il ne mesurait pas l'absence
            // d'avertissement, il mesurait la déduplication. Un état de module partagé entre
            // cas transforme une contre-épreuve en tautologie.
            const handler = () => {};
            Events.on("geoleaf:b240:jamais-vu-ailleurs", handler);
            Events.off("geoleaf:b240:jamais-vu-ailleurs", handler);

            expect(Log.warn).not.toHaveBeenCalled();
        });

        it("n'avertit QU'UNE FOIS par nom, quel que soit le nombre d'appels", () => {
            // Un intégrateur qui s'abonne dans une boucle de rendu noierait sa console, et une
            // console noyée n'avertit plus personne.
            const handler = () => {};
            Events.on("table:selectionChanged", handler);
            Events.on("table:selectionChanged", handler);
            Events.once("table:selectionChanged", handler);
            Events.off("table:selectionChanged", handler);

            expect(Log.warn).toHaveBeenCalledTimes(1);
        });

        it("avertit sur `off` et `once` aussi, pas seulement sur `on`", () => {
            // Un `off()` mal nommé ne retire rien : le handler reste attaché pour toujours.
            // Le silence y coûte une fuite, pas seulement un abonnement mort.
            const handler = () => {};
            Events.off("table:row:dblclick", handler);
            expect(Log.warn).toHaveBeenCalledTimes(1);

            Log.warn.mockClear();
            Events.once("map:somethingElse", handler);
            expect(Log.warn).toHaveBeenCalledTimes(1);
        });

        it("🛑 l'abonnement hors domaine est RÉELLEMENT mort — l'avertissement ne ment pas", () => {
            // ⚠️ Sans ce cas, les précédents prouveraient qu'on avertit, jamais que
            // l'avertissement dit VRAI. C'est la classe B-208 : un test dont l'oracle serait sa
            // propre assertion de log.
            const calls = [];
            Events.on("selectionChanged", () => calls.push(1));

            document.dispatchEvent(new CustomEvent("geoleaf:selectionChanged"));

            expect(calls).toHaveLength(0);
        });
    });
});
