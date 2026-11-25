/**
 * A link opened on a page that cannot read part of it says so, and keeps what it carried.
 *
 * `#…&gl_theme=paysage&gl_f.searchText=Rosario` on a page without `filter`: the lost theme was
 * said (« theme restore dropped »), the filter was not — and the first write of the address
 * rebuilt it from what the page holds, `#gl_lat=…&gl_lng=…&gl_zoom=11`. Copied, the link had
 * lost its filter for good. Red on the code before the fix: no warning, and no `gl_f.` left.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("../../../src/utils/general/di-accessors.js", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getLog: () => ({ warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

const { applyState, startSync } =
    await import("../../../src/capabilities/permalink/permalink-sync.js");

type Globals = { GeoLeaf?: unknown };
const g = globalThis as unknown as Globals;

const map = () =>
    ({
        getCenter: () => ({ lat: 48, lng: 2 }),
        getZoom: () => 11,
        setView: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
    }) as never;

/** The URL the next write of the address produces. */
function written(): Record<string, string> {
    vi.useFakeTimers();
    const replace = vi.spyOn(history, "replaceState").mockImplementation(() => {});
    const m = map() as unknown as { on: ReturnType<typeof vi.fn> };
    const stop = startSync(m as never, { mode: "hash" });
    const onMove = m.on.mock.calls.find(([event]) => event === "moveend")?.[1] as () => void;
    onMove();
    vi.advanceTimersByTime(500);
    const url = String(replace.mock.calls.at(-1)?.[2] ?? "");
    stop();
    replace.mockRestore();
    vi.useRealTimers();
    return Object.fromEntries(new URLSearchParams(url.slice(url.indexOf("#") + 1)));
}

beforeEach(() => {
    warn.mockClear();
});

afterEach(() => {
    delete g.GeoLeaf;
    document.body.innerHTML = "";
});

describe("un lien ouvert sans la capacité qui le lit", () => {
    it("🛑 sans filter : la perte du filtre est dite, et le paramètre reste dans l'adresse", () => {
        g.GeoLeaf = { ThemeSelector: { getCurrentTheme: () => null } };
        applyState(
            { lat: 48, lng: 2, zoom: 11, fieldFilters: { searchText: "Rosario" } },
            map(),
            {}
        );
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));

        expect(warn.mock.calls.some(([m]) => /filter/i.test(String(m)))).toBe(true);
        expect(written()["gl_f.searchText"]).toBe("Rosario");
    });

    it("🛑 sans sélecteur de thèmes : le thème perdu reste dans l'adresse", () => {
        g.GeoLeaf = {};
        vi.useFakeTimers();
        applyState({ lat: 48, lng: 2, zoom: 11, theme: "paysage" }, map(), {});
        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));
        vi.advanceTimersByTime(10_000);
        vi.useRealTimers();

        expect(warn.mock.calls.some(([m]) => /theme restore dropped/.test(String(m)))).toBe(true);
        expect(written()["gl_theme"]).toBe("paysage");
    });

    // 🛑 The two cases above write the address THEMSELVES, after the restore. In the browser,
    // the last write happens BEFORE it — the view set by applyState fires its moveend at once —
    // and nothing wrote again: the link copied before any gesture still lost its filter
    // (seen in a real browser on 25/11/2026). The restore must rewrite the address itself,
    // with no gesture.
    // The browser's path: the link carries a theme AND a filter, the page has neither selector
    // nor filter, and the restore runs from the grace period after app:ready — no event left
    // to trigger a write after it.
    it("🛑 sans filter : l'adresse est réécrite dès la restauration, sans aucun geste", () => {
        g.GeoLeaf = {};
        vi.useFakeTimers();
        const replace = vi.spyOn(history, "replaceState").mockImplementation(() => {});
        applyState(
            {
                lat: 48,
                lng: 2,
                zoom: 11,
                theme: "paysage",
                fieldFilters: { searchText: "Rosario" },
            },
            map(),
            {}
        );
        const stop = startSync(map(), { mode: "hash" });
        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));
        vi.advanceTimersByTime(10_000);
        const url = String(replace.mock.calls.at(-1)?.[2] ?? "");
        stop();
        replace.mockRestore();
        vi.useRealTimers();

        expect(url).toContain("gl_f.searchText=Rosario");
    });

    it("🛑 sans sélecteur de thèmes : l'adresse est réécrite dès que le thème est déclaré perdu", () => {
        g.GeoLeaf = {};
        vi.useFakeTimers();
        const replace = vi.spyOn(history, "replaceState").mockImplementation(() => {});
        applyState({ lat: 48, lng: 2, zoom: 11, theme: "paysage" }, map(), {});
        const stop = startSync(map(), { mode: "hash" });
        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));
        vi.advanceTimersByTime(10_000);
        const url = String(replace.mock.calls.at(-1)?.[2] ?? "");
        stop();
        replace.mockRestore();
        vi.useRealTimers();

        expect(url).toContain("gl_theme=paysage");
    });

    it("avec filter, un filtre vidé ne revient pas dans l'adresse", () => {
        g.GeoLeaf = {
            ThemeSelector: { getCurrentTheme: () => null },
            Filter: {
                getActiveFilter: () => ({ fields: [] }),
                getConfig: () => ({ fields: [{ id: "searchText", kind: "text" }] }),
                applyFilter: vi.fn(),
            },
        };
        document.body.innerHTML = '<div id="gl-filter-panel"></div>';
        applyState(
            { lat: 48, lng: 2, zoom: 11, fieldFilters: { searchText: "Rosario" } },
            map(),
            {}
        );
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));

        expect(written()["gl_f.searchText"]).toBeUndefined();
    });
});
