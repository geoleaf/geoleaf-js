/**
 * The field window — `openModal({ mode: "simple" })`, built by `cache-control-dom.ts`.
 *
 * What a technician needs to prepare a zone, and nothing that administers the cache: at 412 px
 * the zone and the download button were below the fold, behind status, layers, zoom ceiling,
 * tabs and purge. The layer section is BUILT but hidden — it writes the default selection
 * that the download and the quota check read.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";
import { buildStructure } from "../cache/cache-control-dom.js";

// The global the plugin reads, typed loosely: these doubles stand in for the core's facades.
const G = globalThis as unknown as { GeoLeaf?: any };

// The English dictionary is planted, so assertions read what the catalogue says.
let _fileI18n: unknown;
beforeEach(async () => {
    const dict = (await import("../lang/lang-en.js")).default;
    G.GeoLeaf = G.GeoLeaf ?? {};
    _fileI18n = G.GeoLeaf.I18n;
    G.GeoLeaf.I18n = {
        getLabel: (key: string, ...args: unknown[]) => {
            let s: string = (dict as Record<string, string>)[key] ?? key;
            args.forEach((a, n) => (s = s.replace(`{${n}}`, String(a))));
            return s;
        },
    };
    document.body.innerHTML = "";
});
afterEach(() => {
    if (G.GeoLeaf) {
        G.GeoLeaf.I18n = _fileI18n;
        G.GeoLeaf.Storage = undefined;
    }
});

// The tests plant `GeoLeaf.Storage` the way PRODUCTION does. They used to drive
// `StorageContract.init()`, i.e. a SECOND instance of the singleton the bundle
// embedded and nothing initialised: they validated a dead channel.
function _installGeoLeafStorage(api: any) {
    G.GeoLeaf = G.GeoLeaf ?? {};
    // The helper reproduces what `StorageContract.init()` provided, because the
    // core's facade provides it too: `isPluginLoaded()` = "an engine registered",
    // and `isAvailable()` = "and its database is open". The plugin's adapter
    // DELEGATES these two methods — it does not recompute them — so a planted
    // object not carrying them would return `false` where the test expects
    // `true`. A caller providing them keeps the hand.
    G.GeoLeaf.Storage =
        api === null || api === undefined
            ? null
            : {
                  isPluginLoaded: () => true,
                  isAvailable: () => !!api.DB,
                  ...api,
              };
    return api;
}

// ─── State factory ──────────────────────────────────────────────────────────────
//
// Reproduces what `createCacheControl()` builds in `cache-control.ts`: the
// delegations are spies, which makes WHO calls WHAT observable without loading
// the assembler (unreachable, cf. the header warning).

function makeSelf(options: any = {}) {
    const self: any = {
        options: {
            position: options.position || "topright",
            collapsed: options.collapsed || false,
            collapsible: options.collapsible !== false,
            mode: options.mode,
        },
        _eventCleanups: [],
        _map: null,
        _container: document.createElement("div"),
        _bodyEl: null,
        _toggleBtn: null,
        _layersContent: null,
        _layersToggleBtn: null,
        _statusToggleBtn: null,
        _downloadBtn: null,
        _clearBtn: null,
        _stopBtn: null,
        _progressEl: null,
        _progressFill: null,
        _progressText: null,
    };
    self._container.className = "gl-cache-control";
    self._updateStatus = vi.fn().mockResolvedValue(undefined);
    self._populateLayerSelection = vi.fn().mockResolvedValue(undefined);
    self._attachEventListeners = vi.fn();
    // `cache-control-types.ts` declares _handleDownload and _handleClear as
    // `Promise<void>` and _handleStop as `void`. The doubles must honour that: a bare
    // vi.fn() returns undefined, and the caller attaches .catch() to the two async ones.
    // Faithfulness matters here — an unfaithful double is what let a floating promise
    // live in attachEventListeners unnoticed until Q1.4 posed the rule.
    self._handleDownload = vi.fn(() => Promise.resolve());
    self._handleClear = vi.fn(() => Promise.resolve());
    self._handleStop = vi.fn();
    self._handleLayersToggle = vi.fn();
    self._handleStatusToggle = vi.fn();
    self._handleCancelled = vi.fn();
    self._toggleCollapsed = vi.fn();
    self._updateProgress = vi.fn();
    self._updatePullProgress = vi.fn();
    self._updateClearProgress = vi.fn();
    self._cleanup = vi.fn();
    return self;
}

function mount(options: any) {
    const self = makeSelf(options);
    document.body.appendChild(self._container);
    buildStructure(self);
    return self;
}

/** Shown = in the document and no `hidden` on itself or an ancestor. */
function shown(selector: string) {
    const el = document.querySelector(selector);
    if (!el) return false;
    for (let n: HTMLElement | null = el as HTMLElement; n; n = n.parentElement) {
        if (n.hidden) return false;
    }
    return true;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("fenêtre simple — ce qui est montré", () => {
    test("zone, téléchargement, progression et arrêt, phrase d'état ; rien qui administre le cache", () => {
        mount({ mode: "simple" });

        for (const sel of [
            ".gl-cache-simple__state",
            ".gl-cache-zone__buttons",
            "#gl-cache-download",
            "#gl-cache-progress",
            "#gl-cache-stop",
        ]) {
            expect(document.querySelector(sel), sel).not.toBeNull();
        }
        expect(shown(".gl-cache-zone__buttons")).toBe(true);
        expect(shown("#gl-cache-download")).toBe(true);

        // Not built: purge, journal, status rows, sync, quarantine, pre-departure.
        for (const sel of [
            "#gl-cache-clear",
            ".gl-cache-log-export",
            ".gl-cache-status",
            ".gl-cache-sync-status",
            ".gl-cache-quarantine",
            ".gl-cache-preflight",
        ]) {
            expect(document.querySelector(sel), sel).toBeNull();
        }
        // Built for the default selection, but not shown; the zoom ceiling is tuning.
        expect(document.querySelector(".gl-cache-layers")).not.toBeNull();
        expect(shown(".gl-cache-layers")).toBe(false);
        expect(shown(".gl-cache-zone__row")).toBe(false);
        expect(shown(".gl-cache-zone__note")).toBe(false);
    });

    test("la fenêtre complète est inchangée", () => {
        mount({});
        for (const sel of [
            "#gl-cache-clear",
            ".gl-cache-log-export",
            ".gl-cache-status",
            ".gl-cache-sync-status",
            ".gl-cache-quarantine",
            ".gl-cache-preflight",
        ]) {
            expect(document.querySelector(sel), sel).not.toBeNull();
        }
        expect(document.querySelector(".gl-cache-simple")).toBeNull();
        expect(shown(".gl-cache-layers")).toBe(true);
        expect(shown(".gl-cache-zone__row")).toBe(true);
    });
});

describe("fenêtre simple — l'état en une phrase", () => {
    function plant({ status, persistence }: { status: unknown; persistence: string }) {
        _installGeoLeafStorage({
            DB: {},
            CacheManager: { getCacheStatus: vi.fn(async () => status) },
            preflight: vi.fn(async () => ({ persistence, verdict: "ready", layers: [] })),
        });
    }

    test("aucune zone : « No zone prepared », sans avertissement sur un stockage persistant", async () => {
        plant({ status: null, persistence: "persistent" });
        const self = mount({ mode: "simple" });
        await self._refreshPreflight();

        expect(document.querySelector(".gl-cache-simple__state")?.textContent).toBe(
            "No zone prepared"
        );
        expect(shown(".gl-cache-simple__warning")).toBe(false);
    });

    test("zone prête : la phrase dit l'heure, et un stockage non garanti se dit en une ligne", async () => {
        const at = new Date();
        at.setHours(9, 5, 0, 0);
        plant({
            status: { resourcesCount: 12, cachedAt: at.getTime() },
            persistence: "bestEffort",
        });
        const self = mount({ mode: "simple" });
        await flush();
        await self._refreshPreflight();

        const state = document.querySelector(".gl-cache-simple__state") as HTMLElement;
        expect(state.getAttribute("data-state")).toBe("ready");
        expect(state.textContent).toContain("Zone ready for offline use");
        expect(state.textContent).toMatch(/9.05|09.05/);
        expect(shown(".gl-cache-simple__warning")).toBe(true);
        expect(document.querySelector(".gl-cache-simple__warning")?.textContent).toContain(
            "Storage not guaranteed"
        );
    });
});
