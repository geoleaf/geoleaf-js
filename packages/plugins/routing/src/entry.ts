/*!
 * @geoleaf-plugins/routing — Entry point
 * Mounts GeoLeaf.Routing on the global namespace and registers the plugin.
 * ESM only — no UMD, no CommonJS. Loaded AFTER @geoleaf/core, BEFORE GeoLeaf.boot().
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import "./css/geoleaf-routing.css";

import { buildPublicApi } from "./public-api.js";
// Side-effect import: registers the two engines this package ships with. Kept out of the
// numbered steps below because it is not a boot step — it is what makes the configuration
// `provider: "valhalla"` mean something without the host calling anything.
import "./providers/builtins.js";
import { destroyPanel, ensurePanel, openPanel, PANE_ID } from "./itinerary.js";
import { wireEntryPoint } from "./entry-point.js";
import { registerPane } from "./ui-seam.js";

// The route model IS the public contract of this package, and a consumer that only wants to
// TYPE against it must be able to reach it without importing the plugin's side effects.
// Re-exported from the entry because that is what `exports["."].types` points at; the
// declarations are erased at build, so this costs no byte in the bundle.
export type {
    Waypoint,
    RouteRequest,
    RouteStep,
    RouteLeg,
    RouteResult,
    NavState,
    NavProgress,
    RouteFailure,
    RouteOutcome,
    IRouteProvider,
    RouteProviderFactory,
} from "./model.js";

// The toolbar seam is the canonical extension path, and it is TYPED — import the shape from
// the core instead of re-declaring `{ action: string }` inline. Before API publique S3 this
// type was reachable by no channel, so every plugin guessed it, and the guesses diverged
// (`action` vs `action?`, `element?: Element` vs `HTMLElement` vs omitted).
import type { GeoLeafRawEventMap } from "@geoleaf/core";

// Same reasoning for reaching the namespace: `getGeoLeaf()` replaces the
// `const _g = globalThis as any` accessor that the 13 plugins each re-declared their own
// way (STRUCT S2, F6). ⚠️ This file carried that pattern until 31/07/2026, and it was
// invisible to BOTH guards — `packages/_plugin-template/` sits in ESLint's `ignores`
// (placeholder tokens are not valid TS) and outside the `workspaces` globs that
// `count-any.cjs` walks. Every plugin ever scaffolded was therefore born with the two
// `as any` that `@geoleaf/host-runtime` exists to remove. Do not reintroduce them.
import { getGeoLeaf, Log } from "@geoleaf/host-runtime";

import langFr from "./lang/lang-fr.js";
import langEn from "./lang/lang-en.js";

// Replaced at build time by rollup/replace — must be a plain string literal.
const _VERSION = "__GEOLEAF_VERSION__";

// 1 — Register i18n dictionaries FIRST so labels resolve during boot.
getGeoLeaf()?.I18n?.registerDict?.("routing", {
    fr: langFr,
    en: langEn,
});

// 2 — Mount the GeoLeaf.Routing namespace.
//
// ⚠️ The assignment must read `.<Namespace> = buildPublicApi()` LITERALLY, on ONE
// statement. Two guards read this file as TEXT and match a regex — `plugin-namespace-
// declared.guard` wants `/\.([A-Z][A-Za-z0-9]*)\s*=\s*buildPublicApi\s*\(/`. The
// `const _api = buildPublicApi(); _host.X = _api;` form that `create-plugin.cjs` emits
// is matched by NEITHER, so a plugin scaffolded and committed as-is fails a gate that
// never names the scaffold as the cause.
const _host = getGeoLeaf();
if (_host) {
    _host.Routing = buildPublicApi();
}

// 3 — Register in the plugin registry.
getGeoLeaf()?.plugins?.register?.("routing", {
    version: _VERSION,
    requires: [],
    optional: [],
    label: "Routing (calcul d'itinéraire multi-étapes)",
    healthCheck: () => typeof getGeoLeaf()?.Routing === "object",
});

// Toolbar icon (22 px, stroke currentColor) — sanitised by core DOMSecurity.
const _ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"' +
    ' stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>';

// 4 & 5 — Register toolbar slot + wire the action event listener.
//
// ⚠️ `profileKey` MUST sit under `modules.<id>.*` — the SAME namespace `config.ts` reads.
// This file wrote `ui.showRouting` until 08/08/2026, and the two tokens do not
// even substitute alike: `Routing` is PascalCase, `routing` kebab-case
// (`create-plugin.cjs`). A plugin scaffolded as `mon-plugin` therefore read its config at
// `modules.mon-plugin` while its button obeyed `ui.showMonPlugin` — two keys, two casings,
// two branches of the profile. Filling the profile the way `config.ts` documents left the
// button INVISIBLE, with nothing in the output to say why. `selfValidate()` now rejects any
// `profileKey` outside `modules.<id>.`. Reference shape: `packages/plugins/table/src/entry.ts`.
// The slot is declared only on the EAGER path — when the integrator loads this bundle before
// `GeoLeaf.boot()`, as the package README prescribes. There is no `init.js` on that path, so
// THIS call is the ONLY declaration of the slot and it is honoured.
//
// After `init()` — the LAZY path, where a host declares the slot itself with
// `registerLazyForAction()` and loads the bundle on demand — the toolbar is already built: the
// registration would be stored, never drawn, and would log a warning whose intended reader has
// already done what it recommends elsewhere.
//
// ⚠️ `!== true`, not `=== false`: a host without `isInitialized` yields `undefined`, and the
// slot IS declared. Failing open is the right way round — a spurious warning costs a console
// line, a missing declaration costs the button.
if (getGeoLeaf()?.registry?.isInitialized?.() !== true) {
    getGeoLeaf()?.registry?.register?.({
        id: "routing",
        dependencies: [],
        init: () => {},
        // 🛑 A real teardown, not a placeholder. The panel is mounted on `document.body` and
        // deliberately OUTLIVES a close — an itinerary survives collapsing the tab. Without
        // this, a `Core.destroy()` left it in the document, and a `Core.create()` after it
        // would have found a stale panel wired to a torn-down controller.
        //
        // ⚠️ Declaring `init` + `destroy` promotes this registration from a UI-only slot to a
        // lifecycle module — `ModuleRegistry` refuses one of the two alone. `init` is empty on
        // purpose: everything this plugin needs is done at module body, before boot.
        destroy: () => {
            destroyPanel();
        },
        ui: {
            mobileIcon: {
                icon: _ICON,
                labelKey: "routing.toolbar.button",
                profileKey: "modules.routing.showButton",
                requiresPlugin: "routing",
                action: "routing",
            },
            // 🛑 NO `desktopTabButton`. The pane registration below already gives this plugin a
            // tab in the desktop strip — declaring one here too produced TWO controls for one
            // panel, side by side, and the registry one is the better of the two: it activates
            // the pane rather than dispatching an action the plugin has to translate back into
            // opening the pane. The pill keeps its `mobileIcon`, and the kernel marks it
            // `data-gl-desktop-slot` so it is hidden wherever the tab is shown.
        },
    });
}

// 5 bis — Offer the panel as a hostable pane.
//
// The kernel then shows it in whichever surface is live: the desktop side panel above 1440px,
// the mobile sheet below it. Nothing here names either — that is the point of the registry.
//
// ⚠️ ONE attempt, and no `geoleaf:app:ready` fallback. There was one, and it was wrong twice
// over: `BOOT-SUB` refuses a boot subscription at module body — a listener posted after the
// signal waits for an event that has already passed, silently — and the case it guarded cannot
// happen here. This bundle loads AFTER `@geoleaf/core` and BEFORE `GeoLeaf.boot()`, as its
// README prescribes and as `index.html` does, and `GeoLeaf.UI` is mounted at the core's import,
// not at boot. A fallback for a contract violation would have hidden the violation instead.
function declarePane(): boolean {
    return registerPane({
        id: PANE_ID,
        labelKey: "routing.toolbar.button",
        // Built on demand, and this is what makes the tab work at all: the panel is not
        // constructed until something asks for it, and a click on the tab goes to the KERNEL,
        // never to this plugin. Without this hook the tab opened on an empty pane — measured
        // in a browser, not deduced. Idempotent: it fires on every open.
        onOpen: () => {
            ensurePanel();
        },
        // The panel mounts itself on `document.body`, hidden, and the host adopts it from
        // there. Matching on the class rather than an id keeps the selector the same one the
        // stylesheet uses, so the two cannot drift apart.
        selector: ".gl-routing-panel",
    });
}

if (typeof document !== "undefined" && !declarePane()) {
    // Said out loud rather than swallowed: without the pane there is no tab and no sheet entry,
    // so the panel becomes unreachable — and every other part of the plugin still works, which
    // is exactly the shape of failure that gets misread as a styling problem.
    Log.warn(
        "[routing] GeoLeaf.UI.registerPanelPane absent — le panneau n'aura ni onglet ni entrée " +
            "de sheet. Charger ce bundle APRÈS @geoleaf/core, comme le prescrit le README."
    );
}

if (typeof document !== "undefined") {
    document.addEventListener("geoleaf:toolbar:action", (e: Event) => {
        const ce = e as CustomEvent<GeoLeafRawEventMap["geoleaf:toolbar:action"]>;
        if (ce.detail?.action !== "routing") return;
        // Read the surface back OFF the namespace, never from a local — the local is what
        // the scaffold used, and removing it is what makes the namespace mount match the
        // literal form the guards require. Same shape as the rest of the fleet.
        // The optional call is not defensive padding: the panel lands with the feature, and
        // until then this listener must be a no-op rather than a crash.
        openPanel();
    });
}

// 6 — Entry point from a POI. The button itself is declared in the PROFILE, as an `action`
// widget of `feature-info`; this only listens for its event. Placing the button from here would
// mean a plugin reaching into the core's rendering, which is the boundary this repository keeps.
//
// ⚠️ The POI opens as the DESTINATION, not as a stop: the operator starts from a POI they are
// looking at and wants to go there. Adding a stop to an itinerary that does not exist yet has no
// meaning; being taken to a destination does.
if (typeof document !== "undefined") {
    wireEntryPoint((destination) => {
        openPanel([destination]);
    });
}
