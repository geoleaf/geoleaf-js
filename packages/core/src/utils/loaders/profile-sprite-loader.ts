/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Profile SVG sprite loader.
 *
 * Injects the active profile's SVG sprite into the DOM; the MapLibre POI icon
 * registrar (`adapters/maplibre/maplibre-poi-icons.ts`) then reads that sprite and
 * registers each `<symbol>` as a MapLibre image, while the legend and taxonomy
 * capabilities read the same DOM sprite to render icon swatches.
 *
 * This module is **engine-agnostic** — pure DOM + `fetch`, no MapLibre dependency.
 * It lived under `adapters/maplibre/maplibre-sprite-loader.ts` but was
 * relocated here so the legend and taxonomy capabilities depend on a
 * neutral loader and never import from `adapters/maplibre/` — the capability↔engine
 * boundary is now ESLint-guarded (`no-restricted-imports`, block "6ter ter").
 *
 * Security: the profile-controlled sprite URL is SSRF-validated before fetch, and
 * inline `style="…"` attributes are stripped so an untrusted sprite cannot trip a
 * strict `style-src` CSP.
 */

import { Log } from "../log/index.js";
import { getGeoLeaf } from "../general/geoleaf-global.js";
import { validateUrl } from "../../kernel/security/index.js";

/** Sprite / icon config (`modules.taxonomy.icons`) as read by the sprite loader. */
type IconsConfig = { spriteUrl?: unknown } | null;

/** Cache slot stashed on `ensureProfileSpriteInjectedSync` to dedupe debug logs. */
type SpriteLoaderFn = (() => Promise<void>) & { _lastConfig?: IconsConfig };

/**
 * CSS selector matching the injected profile-sprite root. `_appendSvgToBody`
 * stamps the `data-geoleaf-sprite="profile"` attribute; this const is the single
 * source of truth for the DOM signal that its `<symbol>` defs are queryable.
 */
const PROFILE_SPRITE_SELECTOR = 'svg[data-geoleaf-sprite="profile"]';

/**
 * The injection currently in flight, or `null` when none is.
 *
 * The DOM presence check ({@link isProfileSpriteReady}) is not, on its own, a
 * sufficient guard: `ensureProfileSpriteInjectedSync` is called ONCE PER LAYER, and
 * the check runs BEFORE the `await fetch`. Every concurrent caller therefore saw an
 * empty DOM, fetched, and appended — a 16-layer profile ended up with dozens of
 * identical `<svg data-geoleaf-sprite="profile">` roots in `document.body` (40
 * observed on the tourism profile), each one a full sprite parse. Consumers reading
 * the sprite with `document.querySelector` then resolved against an arbitrary copy,
 * and any strict single-element query broke outright.
 *
 * Memoising the promise closes the window: the first caller arms this slot
 * synchronously (before any `await`), every later caller awaits the same injection.
 * The slot is cleared when the injection settles, so a failed attempt (bad URL, HTTP
 * error, parse error) can still be retried by a later layer.
 */
let _injectionInFlight: Promise<void> | null = null;

/**
 * Whether the active profile's SVG sprite is present in the DOM, so a
 * `<use href="#…">` (a legend or taxonomy icon swatch) can resolve against its
 * `<symbol>` defs. Shared readiness signal: the selector lived, re-typed, at every
 * call site (legend-control, legend public-api) — now it lives here, next to the
 * code that stamps the attribute.
 */
export function isProfileSpriteReady(): boolean {
    return (
        typeof document !== "undefined" && document.querySelector(PROFILE_SPRITE_SELECTOR) !== null
    );
}

function _getTaxonomyIcons(): IconsConfig {
    // Read the shared icon config from the taxonomy capability via the runtime
    // seam. In the Lite bundle the capability is tree-shaken out (no
    // `GeoLeaf.Taxonomy`), so this returns null — correct, since no POI layer
    // carries a `symbolId` without taxonomy and thus needs no sprite.
    return getGeoLeaf()?.Taxonomy?.getIcons?.() ?? null;
}

function _logIconsCfgIfChanged(fn: SpriteLoaderFn, iconsCfg: IconsConfig): void {
    if (fn._lastConfig && JSON.stringify(iconsCfg) === JSON.stringify(fn._lastConfig)) return;
    if (Log) Log.debug("[POI] IconsConfig retrieved:", iconsCfg);
    fn._lastConfig = iconsCfg;
}

function _getSpriteUrl(iconsCfg: IconsConfig): string | null {
    if (!iconsCfg) return null;
    const spriteUrl = iconsCfg.spriteUrl;
    if (!spriteUrl) return null;
    if (typeof spriteUrl !== "string") return null;
    return spriteUrl;
}

function _buildSvgElement(svgText: string): Element | null {
    // Strip inline `style="…"` attributes from the sprite source before parsing.
    // DOMParser applies (and CSP-checks) inline styles at parse time — even though
    // the node is never rendered with them — so a sprite carrying e.g.
    // style="display:none" would violate a strict CSP (style-src without
    // 'unsafe-inline', B.5). Sprite symbols rely on presentation attributes
    // (fill/stroke) and currentColor, so removing inline styles is visually inert
    // and a sound defence-in-depth against an untrusted profile sprite. Hiding the
    // sprite container is re-applied via the CSSOM in _appendSvgToBody.
    const safeSvgText = svgText.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, "");
    const parser = new DOMParser();
    const doc = parser.parseFromString(safeSvgText, "image/svg+xml");
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
        if (Log) Log.warn("[POI] SVG sprite parsing error :", parserError.textContent);
        return null;
    }
    const svgEl = doc.documentElement;
    if (!svgEl) return null;
    if (svgEl.tagName.toLowerCase() !== "svg") return null;
    return svgEl;
}

function _appendSvgToBody(svgEl: Element): void {
    svgEl.setAttribute("data-geoleaf-sprite", "profile");
    svgEl.setAttribute("aria-hidden", "true");
    // Strip any literal inline style parsed from the sprite source (e.g.
    // style="display:none"): a literal style attribute is blocked under a strict
    // CSP (style-src without 'unsafe-inline', B.5). Hiding is re-applied below via
    // the CSSOM (per-property writes are not subject to style-src).
    svgEl.removeAttribute("style");
    (svgEl as HTMLElement).style.position = "absolute";
    (svgEl as HTMLElement).style.width = "0";
    (svgEl as HTMLElement).style.height = "0";
    (svgEl as HTMLElement).style.overflow = "hidden";
    if (document.body.firstChild) {
        document.body.insertBefore(svgEl, document.body.firstChild);
    } else {
        document.body.appendChild(svgEl);
    }
    const symbolCount = svgEl.querySelectorAll("symbol").length;
    if (Log)
        Log.info(
            "[POI] Profile SVG sprite injected into DOM (async).",
            symbolCount,
            "symbols loaded."
        );
}

async function _fetchAndInjectSprite(spriteUrl: string): Promise<void> {
    // M1: validate the (profile-controlled) sprite URL before fetching to
    // prevent SSRF / unsafe protocols from an untrusted profile.
    let safeUrl: string;
    try {
        safeUrl = validateUrl(spriteUrl);
    } catch (e) {
        if (Log) Log.warn("[POI] Sprite URL rejected (unsafe):", (e as Error).message);
        return;
    }
    try {
        const response = await fetch(safeUrl);
        if (!response.ok) {
            if (Log) Log.warn("[POI] Profile sprite load error: HTTP", response.status);
            return;
        }
        const svgText = await response.text();
        const svgEl = _buildSvgElement(svgText);
        if (!svgEl) return;
        _appendSvgToBody(svgEl);
    } catch (err) {
        if (Log) Log.warn("[POI] Profile sprite load error (async):", err);
    }
}

/**
 * Injects the active profile's SVG sprite into the DOM (asynchronous). No-op when
 * the icons config or sprite URL is missing, or the sprite is already present.
 * The profile-controlled sprite URL is SSRF-validated before fetch.
 */
export async function ensureProfileSpriteInjectedSync(): Promise<void> {
    const fn = ensureProfileSpriteInjectedSync as SpriteLoaderFn;
    try {
        const iconsCfg = _getTaxonomyIcons();
        if (!iconsCfg) {
            // Debug, not warn: this function is called once per layer, and a profile
            // that ships no sprite — or that switched taxonomy off on purpose — would
            // otherwise flood the console with a warning about a deliberate choice.
            if (Log) Log.debug("[POI] No taxonomy icons config — skipping sprite injection.");
            return;
        }
        _logIconsCfgIfChanged(fn, iconsCfg);
        const spriteUrl = _getSpriteUrl(iconsCfg);
        if (!spriteUrl) {
            if (Log) Log.warn("[POI] spriteUrl missing or invalid:", iconsCfg.spriteUrl);
            return;
        }
        if (isProfileSpriteReady()) {
            if (Log) Log.debug("[POI] SVG sprite already injected");
            return;
        }
        // Another layer is already injecting: join it instead of starting a second
        // fetch + append. Armed below BEFORE the first `await`, so no caller can slip
        // between the DOM check above and the assignment.
        if (_injectionInFlight) {
            if (Log) Log.debug("[POI] SVG sprite injection already in flight — joining it");
            await _injectionInFlight;
            return;
        }
        if (Log) Log.info("[POI] Loading sprite from:", spriteUrl);
        _injectionInFlight = _fetchAndInjectSprite(spriteUrl).finally(() => {
            _injectionInFlight = null;
        });
        await _injectionInFlight;
    } catch (err) {
        if (Log) Log.warn("[POI] Profile sprite load error :", err);
    }
}
