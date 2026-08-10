/**
 * Unit tests — `setupReveal` (backlog COUVERTURE B.2).
 *
 * `app/init-reveal.ts` était mesuré à **21,4 %** (12/56 lignes). C'est l'orchestration qui
 * dévoile l'application : elle décide QUAND le spinner disparaît. Ses garanties — révéler une
 * seule fois, ne jamais rester bloqué (filet de 5 s), et ne pas révéler prématurément quand le
 * profil est incertain — n'étaient vérifiées par rien.
 *
 * `dispatchGeoLeafEvent` est mocké avec le patron complet par construction (backlog B.12).
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

vi.mock("../../src/kernel/events/event-bus.js", async (importActual) => ({
    ...(await importActual()),
    dispatchGeoLeafEvent: vi.fn(),
}));

const { setupReveal } = await import("../../src/app/init-reveal.js");
const { dispatchGeoLeafEvent } = await import("../../src/kernel/events/event-bus.js");

const AppLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

/** Construit un jeu de dépendances de boot, surchargeable. */
function deps(over = {}) {
    const nativeMap = { resize: vi.fn() };
    const map = {
        getNativeMap: vi.fn(() => nativeMap),
        fitBounds: vi.fn(),
    };
    return {
        GeoLeaf: {
            _version: "9.9.9",
            Config: { getActiveProfile: () => ({ themes: { defaultTheme: "clair" } }) },
            ...over.GeoLeaf,
        },
        map,
        AppLog,
        profileBounds: over.profileBounds,
        profilePadding: over.profilePadding,
        permalinkCfg: over.permalinkCfg ?? {},
        _nativeMap: nativeMap,
        ...("map" in over ? { map: over.map } : {}),
    };
}

/** Nombre de fois où l'application a été déclarée prête. */
const readyCount = () =>
    dispatchGeoLeafEvent.mock.calls.filter((c) => c[0] === "geoleaf:app:ready").length;

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="gl-loader"></div>';
});

afterEach(() => {
    // ⚠️ Purge des écouteurs `{once:true}` laissés par un test qui n'a PAS déclenché
    // `geoleaf:theme:applied` : ils survivent sur `document`, et le test suivant réveillerait
    // toutes les fermetures accumulées — chacune avec son propre `_appRevealed`, donc chacune
    // comptant une révélation de plus. Les déclencher ici les consomme (`once`).
    document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
    vi.useRealTimers();
    document.body.innerHTML = "";
});

describe("setupReveal — quand l'application est-elle dévoilée ?", () => {
    test("un profil À THÈME attend `geoleaf:theme:applied` — pas de révélation immédiate", () => {
        setupReveal(deps());
        expect(readyCount()).toBe(0);

        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        expect(readyCount()).toBe(1);
    });

    test("un profil SANS thème par défaut est dévoilé tout de suite (il n'émettra jamais l'événement)", () => {
        setupReveal(deps({ GeoLeaf: { Config: { getActiveProfile: () => ({ themes: {} }) } } }));
        expect(readyCount()).toBe(1);
    });

    test("le typo historique `defautTheme` compte comme un thème par défaut", () => {
        setupReveal(
            deps({
                GeoLeaf: {
                    Config: {
                        getActiveProfile: () => ({ themes: { config: { defautTheme: "x" } } }),
                    },
                },
            })
        );
        expect(readyCount()).toBe(0);
    });

    test("en cas d'INCERTITUDE (pas de Config), on n'ose pas révéler prématurément", () => {
        setupReveal(deps({ GeoLeaf: { Config: undefined } }));
        expect(readyCount()).toBe(0);
    });

    test("une Config qui jette vaut incertitude — donc pas de révélation immédiate", () => {
        setupReveal(
            deps({
                GeoLeaf: {
                    Config: {
                        getActiveProfile: () => {
                            throw new Error("profil illisible");
                        },
                    },
                },
            })
        );
        expect(readyCount()).toBe(0);
    });

    test("le filet de sécurité dévoile à 5 s même si rien n'arrive", () => {
        setupReveal(deps());
        expect(readyCount()).toBe(0);
        vi.advanceTimersByTime(5000);
        expect(readyCount()).toBe(1);
    });

    test("la révélation est IDEMPOTENTE — thème puis filet ne comptent qu'une fois", () => {
        setupReveal(deps());
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        vi.advanceTimersByTime(5000);
        expect(readyCount()).toBe(1);
    });
});

describe("setupReveal — le spinner", () => {
    test("le loader reçoit la classe de fondu puis disparaît via le filet de 800 ms", () => {
        setupReveal(deps());
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        const loader = document.getElementById("gl-loader");
        expect(loader.classList.contains("gl-loader--fade")).toBe(true);
        expect(loader.style.display).not.toBe("none");

        vi.advanceTimersByTime(800);
        expect(loader.style.display).toBe("none");
    });

    test("`transitionend` masque le loader sans attendre le filet", () => {
        setupReveal(deps());
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        const loader = document.getElementById("gl-loader");
        loader.dispatchEvent(new Event("transitionend"));
        expect(loader.style.display).toBe("none");
    });

    test("l'absence de loader dans le DOM ne fait pas échouer la révélation", () => {
        document.body.innerHTML = "";
        setupReveal(deps());
        expect(() =>
            document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"))
        ).not.toThrow();
        expect(readyCount()).toBe(1);
    });
});

describe("setupReveal — la carte", () => {
    test("la carte native est redimensionnée à la révélation", () => {
        const d = deps();
        setupReveal(d);
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        expect(d._nativeMap.resize).toHaveBeenCalledTimes(1);
    });

    test("les bornes du profil sont réappliquées après 120 ms", () => {
        const d = deps({
            profileBounds: [
                [0, 0],
                [1, 1],
            ],
        });
        setupReveal(d);
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        expect(d.map.fitBounds).not.toHaveBeenCalled();

        vi.advanceTimersByTime(120);
        expect(d.map.fitBounds).toHaveBeenCalledTimes(1);
    });

    test("un état de permalink INTERDIT le recadrage — l'URL fait autorité", () => {
        const d = deps({
            profileBounds: [
                [0, 0],
                [1, 1],
            ],
            GeoLeaf: { Permalink: { getState: () => ({ zoom: 5 }) } },
        });
        setupReveal(d);
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        vi.advanceTimersByTime(120);
        expect(d.map.fitBounds).not.toHaveBeenCalled();
    });

    test("un permalink SANS état stocké laisse le recadrage se faire", () => {
        const d = deps({
            profileBounds: [
                [0, 0],
                [1, 1],
            ],
            GeoLeaf: { Permalink: { getState: () => null } },
        });
        setupReveal(d);
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        vi.advanceTimersByTime(120);
        expect(d.map.fitBounds).toHaveBeenCalledTimes(1);
    });

    test("un fitBounds qui jette est journalisé, pas propagé", () => {
        const d = deps({
            profileBounds: [
                [0, 0],
                [1, 1],
            ],
        });
        d.map.fitBounds = vi.fn(() => {
            throw new Error("bornes invalides");
        });
        setupReveal(d);
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        expect(() => vi.advanceTimersByTime(120)).not.toThrow();
        expect(AppLog.warn).toHaveBeenCalled();
    });

    test("sans bornes de profil, aucun recadrage", () => {
        const d = deps();
        setupReveal(d);
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        vi.advanceTimersByTime(120);
        expect(d.map.fitBounds).not.toHaveBeenCalled();
    });
});

describe("setupReveal — les événements de fin de boot", () => {
    test("émet `geoleaf:map:ready` puis `geoleaf:app:ready` avec la version", () => {
        setupReveal(deps());
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));

        const names = dispatchGeoLeafEvent.mock.calls.map((c) => c[0]);
        expect(names).toContain("geoleaf:map:ready");
        expect(names).toContain("geoleaf:app:ready");

        const ready = dispatchGeoLeafEvent.mock.calls.find((c) => c[0] === "geoleaf:app:ready");
        expect(ready[1].version).toBe("9.9.9");
        expect(typeof ready[1].timestamp).toBe("number");
    });

    test("la raison de la révélation est journalisée", () => {
        setupReveal(deps());
        vi.advanceTimersByTime(5000);
        expect(AppLog.info).toHaveBeenCalledWith(expect.stringContaining("safety timeout 5s"));
    });
});

describe("setupReveal — le crochet Permalink", () => {
    test("applique l'état stocké et démarre la synchro", () => {
        const permalink = { applyStoredState: vi.fn(), startSync: vi.fn(), getState: () => null };
        const d = deps({ GeoLeaf: { Permalink: permalink } });
        setupReveal(d);
        expect(permalink.applyStoredState).toHaveBeenCalledWith(d.map);
        expect(permalink.startSync).toHaveBeenCalledWith(d.map);
    });

    test("`enabled: false` désactive le crochet", () => {
        const permalink = { applyStoredState: vi.fn(), startSync: vi.fn(), getState: () => null };
        setupReveal(deps({ GeoLeaf: { Permalink: permalink }, permalinkCfg: { enabled: false } }));
        expect(permalink.applyStoredState).not.toHaveBeenCalled();
    });

    test("un crochet qui jette est journalisé et n'empêche pas la révélation", () => {
        const permalink = {
            applyStoredState: () => {
                throw new Error("état corrompu");
            },
            startSync: vi.fn(),
            getState: () => null,
        };
        setupReveal(deps({ GeoLeaf: { Permalink: permalink } }));
        expect(AppLog.warn).toHaveBeenCalled();
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        expect(readyCount()).toBe(1);
    });
});
