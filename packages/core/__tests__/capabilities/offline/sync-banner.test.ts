/**
 * THE SYNC STRIP — the second axis finally has a representation IN THE CORE.
 *
 * ⚠️ "Permanent" is about ownership, not pixels, and the distinction is tested below: the
 * strip is mounted and subscribed at all times, and shows itself when it has something to
 * say. It took its ~43 px in every state at first, including the only state a consultation
 * profile ever reaches — and there it also painted under the theme pills.
 *
 * 🛑 A technician spent a day off-network and nothing on screen said how many captures were
 * still held, when the device last succeeded, or whether anything had been set aside. A live
 * `⏳ N` counter did exist — in `@geoleaf-plugins/editor`'s floating tool menu — so it left
 * with the plugin, and the core painted nothing at all.
 *
 * ⚠️ The audit's wording is requalified in the module's own header: "no permanent indicator
 * of the write queue" was too broad (that counter reads the WHOLE outbox); what was true is
 * "nothing permanent in the CORE's chrome".
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from "vitest";

// ⚠️ The modules under test are loaded DYNAMICALLY: their types are unknown at write time.
// `any` is the honest form here — pretending to type an import whose evaluation ORDER is the
// test's subject would give false assurance. Same arbitration as `routes-store.test.ts`.

describe("bandeau de synchronisation", () => {
    let StorageContract: any;
    let mountSyncBanner: any;
    let unmountSyncBanner: any;
    let LAST_SYNC_PREFERENCE: string;

    let entries: { state: string }[];
    let prefs: Record<string, unknown>;

    const settle = () => new Promise<void>((r) => setTimeout(r, 0));

    /**
     * Waits for the strip to have repainted.
     *
     * ⚠️ Goes through the EVENT, not an exported refresh: the strip has no public refresh —
     * nothing outside drives it — and driving it by hand in a test would exercise a path
     * production never takes.
     */
    const repaint = async () => {
        document.dispatchEvent(new CustomEvent("geoleaf:offline:outbox-drained"));
        await settle();
        await settle();
    };

    const banner = () => document.querySelector<HTMLElement>(".gl-sync-banner");
    const text = (cls: string) => banner()?.querySelector(`.gl-sync-banner__${cls}`)?.textContent;
    const action = () => banner()?.querySelector<HTMLButtonElement>(".gl-sync-banner__action");
    const close = () => banner()?.querySelector<HTMLButtonElement>(".gl-sync-banner__close");
    /** `true` when the strip is taking room on screen — neither idle nor acknowledged. */
    const shown = () =>
        banner()?.dataset["idle"] === "false" && banner()?.dataset["dismissed"] === "false";
    /** Clicks the dismiss button and lets its own read settle. */
    const dismiss = async () => {
        close()!.click();
        await settle();
        await settle();
    };

    function mountEngine() {
        const outbox = { list: async () => entries };
        const preferences = {
            getPreference: async (key: string, def: unknown) => prefs[key] ?? def,
        };
        StorageContract.init({
            get DB() {
                return {
                    _ensureModule: (name: string) => (name === "Outbox" ? outbox : preferences),
                };
            },
            isAvailable: () => true,
        });
    }

    beforeAll(async () => {
        ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
        ({ mountSyncBanner, unmountSyncBanner } =
            await import("../../../src/capabilities/offline/ui/sync-banner.js"));
        ({ LAST_SYNC_PREFERENCE } =
            await import("../../../src/capabilities/offline/write/push-engine.js"));
    });

    beforeEach(() => {
        document.body.innerHTML = '<main class="gl-main"><div id="geoleaf-map"></div></main>';
        entries = [];
        prefs = {};
        Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
        mountEngine();
    });

    afterEach(() => {
        unmountSyncBanner();
        document.body.innerHTML = "";
    });

    test("se monte en TÊTE de `.gl-main` — pas dans le markup de la coquille", async () => {
        mountSyncBanner();
        await repaint();

        const main = document.querySelector(".gl-main")!;
        // ⚠️ Created at runtime, deliberately: `apps/geoleaf-app/index.html` is patched by
        // `build-deploy.cjs` with `/gm` regexes and guarded by APP-04/05/08 — a markup anchor
        // there would be a standing risk for a strip a `querySelector` can find.
        expect(main.firstElementChild).toBe(banner());
        expect(banner()!.getAttribute("role")).toBe("status");
    });

    test("🛑 dit ce qui est DÛ, y compris les entrées `failed` et `inFlight`", async () => {
        entries = [
            { state: "pending" },
            { state: "failed" },
            { state: "inFlight" },
            { state: "synced" },
        ];
        mountSyncBanner();
        await repaint();

        // `failed` is NOT terminal (the drain's contract) and `inFlight` is a capture that
        // left without an answer: counting them as sent would tell the technician they can go.
        expect(text("pending")).toContain("3");
    });

    test("file vide → « tout est envoyé », et le bouton est éteint", async () => {
        mountSyncBanner();
        await repaint();

        expect(text("pending")).toBe("Tout est envoyé");
        expect(action()!.disabled).toBe(true);
    });

    test("la quarantaine est comptée À PART, et masquée quand elle est vide", async () => {
        entries = [{ state: "pending" }, { state: "quarantined" }];
        mountSyncBanner();
        await repaint();

        // The contract describes it as "kept, visible, but not replayable as-is": folding it
        // into what is owed would promise that a drain will clear it.
        expect(text("pending")).toContain("1");
        expect(text("quarantine")).toContain("1");
        expect(banner()!.querySelector<HTMLElement>(".gl-sync-banner__quarantine")!.hidden).toBe(
            false
        );
    });

    test("aucune quarantaine → le segment est masqué", async () => {
        entries = [{ state: "pending" }];
        mountSyncBanner();
        await repaint();
        expect(banner()!.querySelector<HTMLElement>(".gl-sync-banner__quarantine")!.hidden).toBe(
            true
        );
    });

    test("hors réseau : l'état bascule et le bouton s'éteint même avec des entrées dues", async () => {
        entries = [{ state: "pending" }];
        Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
        mountSyncBanner();
        await repaint();

        expect(banner()!.dataset["network"]).toBe("offline");
        expect(text("net")).toBe("Hors ligne");
        // A button that does nothing when pressed teaches the user to stop pressing it.
        expect(action()!.disabled).toBe(true);
    });

    test("jamais synchronisé le dit ; sinon il dit COMBIEN DE TEMPS, pas une heure", async () => {
        mountSyncBanner();
        await repaint();
        expect(text("last")).toBe("jamais synchronisé");

        prefs[LAST_SYNC_PREFERENCE] = Date.now() - 3 * 60_000;
        await repaint();
        // A clock reading forces the reader to subtract, on a device whose clock they did not
        // set. The question being asked is "how long ago".
        expect(text("last")).toContain("3 min");
    });

    test("🛑 se rafraîchit sur les DEUX événements du core", async () => {
        mountSyncBanner();
        await repaint();
        expect(text("pending")).toBe("Tout est envoyé");

        entries = [{ state: "pending" }];
        document.dispatchEvent(new CustomEvent("geoleaf:offline:outbox-queued"));
        await new Promise<void>((r) => setTimeout(r, 0));
        expect(text("pending")).toContain("1");

        entries = [];
        document.dispatchEvent(new CustomEvent("geoleaf:offline:outbox-drained"));
        await new Promise<void>((r) => setTimeout(r, 0));
        expect(text("pending")).toBe("Tout est envoyé");
    });

    test("l'appui demande un drain — la seule action qui n'a pas d'autre domicile", async () => {
        entries = [{ state: "pending" }];
        const requested: string[] = [];
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Storage: { _requestOutboxDrain: (cause: string) => requested.push(cause) },
        };
        mountSyncBanner();
        await repaint();

        action()!.click();

        expect(requested).toEqual(["banner"]);
        delete (globalThis as Record<string, unknown>).GeoLeaf;
    });

    test("`enabled: false` ne monte rien", async () => {
        mountSyncBanner({ enabled: false });
        expect(banner()).toBeNull();
    });

    test("sans hôte, il ne devine pas — il ne monte rien", async () => {
        document.body.innerHTML = "";
        mountSyncBanner();
        expect(banner()).toBeNull();
    });

    test("🛑 le démontage relâche les écouteurs — sinon ils S'EMPILENT au remontage", async () => {
        // ⚠️ TWO FORMULATIONS WERE TRIED AND CAME OUT GREEN UNDER MUTATION, which is this
        // test's real lesson. "the node is gone": `_root.remove()` runs anyway. "no more
        // reads after unmount": `_els = null` alone achieves that, listeners or not. What the
        // unsubscribe loop REALLY guards is the STACKING — a mount/unmount/mount cycle leaves
        // two listeners on the same event, hence two database reads per write on a field
        // device. It is observed through the read count.
        let reads = 0;
        StorageContract.init({
            get DB() {
                return {
                    _ensureModule: (name: string) =>
                        name === "Outbox"
                            ? {
                                  list: async () => {
                                      reads += 1;
                                      return [];
                                  },
                              }
                            : { getPreference: async (_k: string, d: unknown) => d },
                };
            },
            isAvailable: () => true,
        });

        mountSyncBanner();
        unmountSyncBanner();
        document.body.innerHTML = '<main class="gl-main"></main>';
        mountSyncBanner();
        await repaint();
        reads = 0;

        document.dispatchEvent(new CustomEvent("geoleaf:offline:outbox-queued"));
        await new Promise<void>((r) => setTimeout(r, 0));
        await new Promise<void>((r) => setTimeout(r, 0));

        expect(reads).toBe(1);
    });

    describe("il ne prend de la place que lorsqu'il a quelque chose à dire", () => {
        test("🛑 au repos il ne s'affiche pas — mais il est monté et abonné", async () => {
            mountSyncBanner();
            await repaint();

            // Nothing owed, nothing set aside, network up: the one sentence it could go on
            // repeating for a whole session. On a deliverable it is the ONLY state most
            // sessions ever reach — `build-deploy` strips the write endpoints.
            expect(banner()!.dataset["idle"]).toBe("true");
            // 🛑 And it is still THERE. This is the whole difference with unmounting it: the
            // listeners never stopped, so the next queued write brings it straight back
            // without anything having to re-mount anything.
            expect(document.querySelector(".gl-main")!.firstElementChild).toBe(banner());
        });

        test("une écriture due le fait réapparaître", async () => {
            mountSyncBanner();
            await repaint();
            expect(shown()).toBe(false);

            entries = [{ state: "pending" }];
            await repaint();

            expect(shown()).toBe(true);
        });

        test("hors réseau, file vide : il s'affiche quand même", async () => {
            // ⚠️ Being off-network IS information, even with nothing owed: it tells the
            // technician that what they capture next will be held rather than sent.
            Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
            mountSyncBanner();
            await repaint();

            expect(shown()).toBe(true);
        });

        test("une quarantaine seule suffit à l'afficher", async () => {
            // Nothing is owed — the drain will never touch these — and that is exactly why
            // it must be said: an entry set aside is a capture that will not leave on its own.
            entries = [{ state: "quarantined" }];
            mountSyncBanner();
            await repaint();

            expect(shown()).toBe(true);
            expect(action()!.disabled).toBe(true);
        });
    });

    describe("le renvoi acquitte ce qui a été vu, pas ce qui arrivera", () => {
        test("le bouton de fermeture le masque", async () => {
            entries = [{ state: "pending" }];
            mountSyncBanner();
            await repaint();
            expect(shown()).toBe(true);

            await dismiss();

            expect(banner()!.dataset["dismissed"]).toBe("true");
            // Hidden, not unmounted — the distinction is the subject of the next test.
            expect(banner()).not.toBeNull();
        });

        test("un drain qui fait BAISSER le compte ne le ramène pas", async () => {
            entries = [{ state: "pending" }, { state: "pending" }];
            mountSyncBanner();
            await repaint();
            await dismiss();

            entries = [{ state: "pending" }];
            await repaint();

            // Re-opening on an improvement would punish the drain for working, and teach the
            // operator that closing the strip achieves nothing.
            expect(banner()!.dataset["dismissed"]).toBe("true");
        });

        test("🛑 une écriture DE PLUS le ramène", async () => {
            entries = [{ state: "pending" }];
            mountSyncBanner();
            await repaint();
            await dismiss();

            entries = [{ state: "pending" }, { state: "pending" }];
            await repaint();

            // A close that held forever would turn a safety net into an off switch nobody
            // decided to install.
            expect(shown()).toBe(true);
        });

        test("🛑 le réseau qui tombe le ramène", async () => {
            entries = [{ state: "pending" }];
            mountSyncBanner();
            await repaint();
            await dismiss();

            Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
            await repaint();

            expect(shown()).toBe(true);
        });

        test("une mise à l'écart DE PLUS le ramène", async () => {
            entries = [{ state: "pending" }];
            mountSyncBanner();
            await repaint();
            await dismiss();

            entries = [{ state: "pending" }, { state: "quarantined" }];
            await repaint();

            expect(shown()).toBe(true);
        });

        test("🛑 revenu au repos, l'acquittement est OUBLIÉ", async () => {
            entries = [{ state: "pending" }];
            mountSyncBanner();
            await repaint();
            await dismiss();

            // Drained: nothing left to acknowledge.
            entries = [];
            await repaint();
            expect(banner()!.dataset["idle"]).toBe("true");

            // ⚠️ Without dropping the acknowledgement here, this next capture would be
            // compared against a stale baseline of 1 and stay hidden — the strip would go
            // silent for the rest of the session after a single click.
            entries = [{ state: "pending" }];
            await repaint();

            expect(shown()).toBe(true);
        });
    });

    test("🛑 il publie son encombrement, et le REND au démontage", async () => {
        mountSyncBanner();
        await repaint();
        const main = document.querySelector<HTMLElement>(".gl-main")!;

        // The map is `inset: 0` in this same block, so the strip covers it rather than
        // pushing it: everything anchored to the top edge has to be told how much room is
        // taken. Measured rather than assumed — the height doubles under `pointer: coarse`.
        expect(main.style.getPropertyValue("--gl-map-top-inset")).not.toBe("");

        unmountSyncBanner();

        // A strip that leaves without clearing its footprint keeps every top-anchored surface
        // pushed down by a band that no longer exists.
        expect(main.style.getPropertyValue("--gl-map-top-inset")).toBe("");
    });
});
