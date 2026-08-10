/**
 * Configuration globale Vitest
 * Executed before all tests
 */

import Module from "node:module";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from "node:util";
import { performance as nodePerf } from "node:perf_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Only `./__mocks__/maplibre-gl.cjs` below is a genuinely CommonJS target.
const require = createRequire(import.meta.url);

// ── jest → vi alias ───────────────────────────────────────────────────────────
// Some engine unit tests relocated from plugin-storage (S14 Phase B) use jest.fn()
// / jest.spyOn() from the Jest era; expose vi under the jest name so they run.
if (typeof globalThis.jest === "undefined" && typeof vi !== "undefined") {
    globalThis.jest = vi;
}

// Node 18 compat: SharedArrayBuffer.prototype.growable was added in Node 20.
// webidl-conversions v8 (shipped with whatwg-url inside jsdom) reads its descriptor
// at module-evaluation time (lib/index.js:299). On Node 18 the descriptor is missing,
// which throws "Cannot read properties of undefined (reading 'get')".
// This polyfill runs before any test file's CJS require() triggers whatwg-url loading.
if (
    typeof SharedArrayBuffer !== "undefined" &&
    !Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "growable")
) {
    Object.defineProperty(SharedArrayBuffer.prototype, "growable", {
        get: function () {
            return false;
        },
        configurable: true,
        enumerable: false,
    });
}
if (
    typeof ArrayBuffer !== "undefined" &&
    !Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")
) {
    Object.defineProperty(ArrayBuffer.prototype, "resizable", {
        get: function () {
            return false;
        },
        configurable: true,
        enumerable: false,
    });
}

// ── .js → .ts require() redirect ─────────────────────────────────────────────
// When CJS test files (or esbuild-transformed source files) call
// require("./foo.js") and foo.js doesn't exist but foo.ts does, redirect to .ts.
// tsx (loaded via --import tsx in forks pool) already handles this for CJS via
// its own Module._resolveFilename patch. This block is a belt-and-suspenders
// fallback in case tsx's patch doesn't cover all edge cases.
{
    const _orig = Module._resolveFilename.bind(Module);
    Module._resolveFilename = function (request, parent, isMain, options) {
        // @geoleaf/field-renderer has no CJS "require" export in its package.json
        // exports map (ESM-only). Redirect to the TypeScript source so tsx can load it.
        if (request === "@geoleaf/field-renderer") {
            return resolve(__dirname, "../../libs/field-renderer/src/index.ts");
        }
        if (
            typeof request === "string" &&
            request.startsWith(".") &&
            request.endsWith(".js") &&
            parent?.filename &&
            !parent.filename.includes("node_modules")
        ) {
            const dir = dirname(parent.filename);
            const tsPath = resolve(dir, request.slice(0, -3) + ".ts");
            if (existsSync(tsPath)) {
                return _orig(tsPath, parent, isMain, options);
            }
        }
        return _orig(request, parent, isMain, options);
    };
}

// ── Offline engine IndexedDB stub (S14 Phase B) ──────────────────────────────
// The relocated engine unit tests need the in-core IndexedDB layer stubbed (the
// real layer opens a database — unavailable under happy-dom). Vite resolve.alias
// is NOT applied to tsx require() resolution, so intercept here (mirrors the
// former plugin-storage setup.js). Scoped to importers under capabilities/offline
// so no other core module is affected.
{
    const mockIdb = resolve(__dirname, "__mocks__/indexeddb.js");
    const _origIdb = Module._resolveFilename.bind(Module);
    Module._resolveFilename = function (request, parent, isMain, options) {
        if (
            parent?.filename &&
            parent.filename.replace(/\\/g, "/").includes("capabilities/offline") &&
            (request === "./indexeddb.js" ||
                request === "../indexeddb.js" ||
                request === "../db/indexeddb.js")
        ) {
            return mockIdb;
        }
        return _origIdb(request, parent, isMain, options);
    };
}

// ── vi.mock() interception for require() calls — REMOVED (COUVERTURE S4, B.11) ──
// This block patched Module._load to serve vi.mock() factories to require() calls.
// Its last consumers were the S3/S4 test files loading sources via require(); once they
// moved to import/await import(), a probe over the full suite recorded ZERO mocks served
// (0 LOAD-MOCK events across 8490 tests). Removed on proof, per the S5 method.

// TextEncoder/TextDecoder for JSDOM (whatwg-url) — used by controls-integration and other tests via module-loader
if (typeof globalThis.TextEncoder === "undefined") {
    globalThis.TextEncoder = NodeTextEncoder;
    globalThis.TextDecoder = NodeTextDecoder;
}

// ── performance.now — required by happy-dom Event constructor ─────────────────
// happy-dom v20 stamps every Event/CustomEvent with performance.now() at
// construction (lib/event/Event.js). In the forks pool, globalThis.performance
// may lack a callable now(), so `new CustomEvent(...)` throws
// "performance.now is not a function" and breaks every event-dispatching test.
// Back it with Node's perf_hooks.performance, which is always available on Node 22.
{
    const hasNow = (obj) => {
        try {
            return obj && typeof obj.now === "function";
        } catch {
            return false;
        }
    };
    // Force the binding even when `performance` is a getter-only accessor on the
    // happy-dom window (same pattern as navigator.geolocation), or when its `now`
    // is missing. defineProperty bypasses a missing setter; fall back to patching
    // `.now` directly if the property itself can't be redefined.
    for (const host of [globalThis, typeof window !== "undefined" ? window : null]) {
        if (!host) continue;
        if (hasNow(host.performance)) continue;
        try {
            Object.defineProperty(host, "performance", {
                value: nodePerf,
                writable: true,
                configurable: true,
                enumerable: true,
            });
        } catch {
            try {
                host.performance.now = nodePerf.now.bind(nodePerf);
            } catch {
                /* give up — happy-dom default stands */
            }
        }
    }
}

// ── CSS.supports — real color validation for happy-dom ───────────────────────
// happy-dom v20 stubs CSS.supports() to ALWAYS return true (see
// node_modules/happy-dom/lib/css/CSS.js:48). validateColor() falls back to
// CSS.supports("color", value) for non-regex colors, so under happy-dom every
// string is accepted — breaking the "reject invalid color" tests. Replace the
// stub with a realistic CSS color validator. Only the ("color", value) form is
// validated; any other condition keeps the permissive default.
{
    // happy-dom exposes CSS as an instance whose supports() lives on the class
    // prototype; globalThis.CSS and window.CSS can also be distinct objects.
    // Patch the prototype AND every reachable instance via defineProperty so the
    // override holds regardless of which reference validateColor resolves.
    const cssObjs = [];
    if (typeof CSS !== "undefined") cssObjs.push(CSS);
    if (typeof globalThis !== "undefined" && globalThis.CSS) cssObjs.push(globalThis.CSS);
    if (typeof window !== "undefined" && window.CSS) cssObjs.push(window.CSS);
    const cssProtos = cssObjs
        .map((o) => Object.getPrototypeOf(o))
        .filter((p) => p && typeof p.supports === "function");
    const targets = [...new Set([...cssObjs, ...cssProtos])];
    if (targets.length > 0) {
        const NAMED_COLORS = new Set([
            "transparent",
            "currentcolor",
            "inherit",
            "initial",
            "unset",
            "revert",
            "black",
            "silver",
            "gray",
            "grey",
            "white",
            "maroon",
            "red",
            "purple",
            "fuchsia",
            "green",
            "lime",
            "olive",
            "yellow",
            "navy",
            "blue",
            "teal",
            "aqua",
            "orange",
            "aliceblue",
            "antiquewhite",
            "aquamarine",
            "azure",
            "beige",
            "bisque",
            "blanchedalmond",
            "blueviolet",
            "brown",
            "burlywood",
            "cadetblue",
            "chartreuse",
            "chocolate",
            "coral",
            "cornflowerblue",
            "cornsilk",
            "crimson",
            "cyan",
            "darkblue",
            "darkcyan",
            "darkgoldenrod",
            "darkgray",
            "darkgreen",
            "darkkhaki",
            "darkmagenta",
            "darkolivegreen",
            "darkorange",
            "darkorchid",
            "darkred",
            "darksalmon",
            "darkseagreen",
            "darkslateblue",
            "darkslategray",
            "darkturquoise",
            "darkviolet",
            "deeppink",
            "deepskyblue",
            "dimgray",
            "dodgerblue",
            "firebrick",
            "floralwhite",
            "forestgreen",
            "gainsboro",
            "ghostwhite",
            "gold",
            "goldenrod",
            "greenyellow",
            "honeydew",
            "hotpink",
            "indianred",
            "indigo",
            "ivory",
            "khaki",
            "lavender",
            "lavenderblush",
            "lawngreen",
            "lemonchiffon",
            "lightblue",
            "lightcoral",
            "lightcyan",
            "lightgoldenrodyellow",
            "lightgray",
            "lightgreen",
            "lightpink",
            "lightsalmon",
            "lightseagreen",
            "lightskyblue",
            "lightslategray",
            "lightsteelblue",
            "lightyellow",
            "limegreen",
            "linen",
            "magenta",
            "mediumaquamarine",
            "mediumblue",
            "mediumorchid",
            "mediumpurple",
            "mediumseagreen",
            "mediumslateblue",
            "mediumspringgreen",
            "mediumturquoise",
            "mediumvioletred",
            "midnightblue",
            "mintcream",
            "mistyrose",
            "moccasin",
            "navajowhite",
            "oldlace",
            "olivedrab",
            "orangered",
            "orchid",
            "palegoldenrod",
            "palegreen",
            "paleturquoise",
            "palevioletred",
            "papayawhip",
            "peachpuff",
            "peru",
            "pink",
            "plum",
            "powderblue",
            "rosybrown",
            "royalblue",
            "saddlebrown",
            "salmon",
            "sandybrown",
            "seagreen",
            "seashell",
            "sienna",
            "skyblue",
            "slateblue",
            "slategray",
            "snow",
            "springgreen",
            "steelblue",
            "tan",
            "thistle",
            "tomato",
            "turquoise",
            "violet",
            "wheat",
            "whitesmoke",
            "yellowgreen",
        ]);
        const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
        const RGB = /^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(?:,\s*[\d.]+%?\s*)?\)$/i;
        const HSL =
            /^hsla?\(\s*[\d.]+(?:deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(?:,\s*[\d.]+%?\s*)?\)$/i;
        const isCssColor = (raw) => {
            if (typeof raw !== "string") return false;
            const v = raw.trim().toLowerCase();
            if (!v) return false;
            return NAMED_COLORS.has(v) || HEX.test(v) || RGB.test(v) || HSL.test(v);
        };
        const supportsImpl = function (condition, value) {
            // Two-arg form: CSS.supports(property, value)
            if (typeof value !== "undefined") {
                if (String(condition).toLowerCase() === "color") {
                    return isCssColor(value);
                }
                return true; // keep permissive for non-color properties
            }
            return true; // single-condition form unchanged
        };
        for (const target of targets) {
            Object.defineProperty(target, "supports", {
                value: supportsImpl,
                writable: true,
                configurable: true,
                enumerable: false,
            });
        }
    }
}

// ── navigator.geolocation — make assignable for happy-dom ────────────────────
// happy-dom defines navigator.geolocation as a getter-only property on the
// Navigator prototype, so tests doing `navigator.geolocation = { watchPosition }`
// throw "Cannot set property geolocation ... which has only a getter". Redefine
// it on the instance as a writable+configurable data property so geolocation
// tests can stub and restore it freely (the descriptor is configurable: true).
if (typeof navigator !== "undefined") {
    let _geo;
    try {
        _geo = navigator.geolocation;
    } catch {
        _geo = undefined;
    }
    try {
        Object.defineProperty(navigator, "geolocation", {
            value: _geo,
            writable: true,
            configurable: true,
            enumerable: true,
        });
    } catch {
        // If the instance property can't be redefined, leave happy-dom's default.
    }
}

// Sprint 9: Leaflet mock removed — MapLibre is the sole engine.
global.maplibregl = require("./__mocks__/maplibre-gl.cjs");

// requestAnimationFrame / cancelAnimationFrame for jsdom
if (typeof window !== "undefined") {
    window.requestAnimationFrame =
        window.requestAnimationFrame ||
        function (cb) {
            return setTimeout(cb, 16);
        };
    window.cancelAnimationFrame =
        window.cancelAnimationFrame ||
        function (id) {
            clearTimeout(id);
        };
}

// Mock window.fetch
global.fetch = vi.fn(() =>
    Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
        headers: new Map([["content-type", "application/json"]]),
    })
);

// Mock console pour tests plus propres (optional)
global.console = {
    ...console,
    // Masquer les logs pendant les tests (garder error et warn)
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
};

// Clean up after each test
afterEach(() => {
    vi.clearAllMocks();

    // Nettoyer le DOM
    document.body.innerHTML = "";
    document.head.innerHTML = "";
});

// ── vi.resetModules require.cache patch — REMOVED (Q2.3, ESM pur) ────────────
// Patched vi.resetModules to also clear Node's CJS require.cache, because a
// require()'d source wouldn't otherwise be reloaded. Its comment named "the two
// B.10 files still require() a source (offline/cache/storage.ts)" as the reason
// to keep it — but re-verified at Q2.3: zero test files require() a `.ts` source
// today (storage-helper-validation.test.js, the file the comment pointed at, has
// used ESM `import` since before this sprint — its own header says so explicitly).
// The former vi.isolateModules shim it replaced (COUVERTURE S4, B.11) was already
// removed on the same kind of proof: a probe over the full suite recording zero
// consumers.
//
// The former vi.isolateModules shim (COUVERTURE S4, B.11) is GONE. Vitest has no such API;
// this file defined one, and its "use Jest's native isolateModules" branch was dead code
// (setup.js aliases globalThis.jest = vi above, so jest.isolateModules WAS this shim). A
// probe over the full suite recorded ZERO calls — every call site moved to
// vi.resetModules() + await import() in S4. Removing the definition means a stray
// vi.isolateModules() now throws loudly instead of silently faking isolation.

// Variables globales utiles pour tests
global.testHelpers = {
    /**
     * Creates a DOM element for tests
     */
    createMapContainer(id = "test-map") {
        const div = document.createElement("div");
        div.id = id;
        div.style.width = "500px";
        div.style.height = "400px";
        document.body.appendChild(div);
        return div;
    },

    /**
     * Simulate a delay
     */
    async sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    },

    /**
     * Create test POI data
     */
    createMockPOI(overrides = {}) {
        return {
            id: "test-poi-" + Date.now(),
            latlng: [45.5, -73.6],
            label: "Test POI",
            description: "Description de test",
            ...overrides,
        };
    },

    /**
     * Create a test config
     */
    createMockConfig(overrides = {}) {
        return {
            map: {
                target: "test-map",
                center: [45.5, -73.6],
                zoom: 12,
            },
            ui: {
                theme: "light",
            },
            ...overrides,
        };
    },
};

// ── WorkerMock — opt-in Web Worker stub (T9.3.2) ──────────────────────────────
// Tests that need a Worker global can set:  global.Worker = global.WorkerMock
// (or use vi.stubGlobal("Worker", global.WorkerMock) before importing the module)
// This class is NOT set as global.Worker by default to avoid breaking tests
// that rely on Worker being undefined (main-thread fallback path).
global.WorkerMock = function WorkerMock(url) {
    this.url = url;
    this.postMessage = function () {};
    this.terminate = function () {};
    this.onmessage = null;
    this.onerror = null;
};
