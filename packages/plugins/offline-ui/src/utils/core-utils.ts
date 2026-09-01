/*!
 * @geoleaf-plugins/offline-ui — Core utilities accessor
 * © 2026 Mattieu Pottier — MIT License
 *
 * Replaces the deep imports towards `@core/utils/**`. Each helper is read on the
 * RUNNING core namespace (`globalThis.GeoLeaf.Utils`), never imported: that is
 * what lets the bundler stop embedding a copy of the core.
 *
 * ⚠️ Unlike the `Log` accessor, these functions RETURN values. A silent fallback
 * would mask an absent core behind a plausible result — hence the explicit,
 * neutral fallbacks below (empty string, `null`, no-op), which stay readable in
 * test as in degraded production.
 * https://geoleaf.dev
 */

import { getGeoLeaf } from "@geoleaf/host-runtime";

interface CoreUtils {
    DOMSecurity?: {
        clearElement?: (el: HTMLElement) => void;
        clearElementFast?: (el: HTMLElement) => void;
    };
    createElement?: (tag: string, ...rest: unknown[]) => HTMLElement;
    Formatters?: {
        formatDateTime?: (...args: unknown[]) => string;
        formatFileSize?: (
            bytes: number | null | undefined,
            options?: { precision?: number; locale?: string }
        ) => string;
        toMB?: (bytes: number | null | undefined, precision?: number) => string;
        toGB?: (bytes: number | null | undefined, precision?: number) => string;
    };
    events?: Record<string, unknown>;
}

/**
 * The slice of `GeoLeaf.Utils` this plugin reads.
 *
 * The namespace lookup goes through `@geoleaf/host-runtime`'s `getGeoLeaf()`
 * (which also tests `window`) instead of a direct `globalThis` access: this was
 * the plugin's last place redoing that lookup. The NARROW to {@link CoreUtils}
 * stays local, and must: the slice storage reads (`Formatters`, `createElement`,
 * `events`) is disjoint from addpoi's.
 */
function _utils(): CoreUtils | undefined {
    return getGeoLeaf()?.Utils as CoreUtils | undefined;
}

/** `GeoLeaf.Utils.DOMSecurity` — the core's DOM sanitisation. No-op when the core is absent. */
export const DOMSecurity = {
    clearElement: (el: HTMLElement): void => {
        _utils()?.DOMSecurity?.clearElement?.(el);
    },
    clearElementFast: (el: HTMLElement): void => {
        _utils()?.DOMSecurity?.clearElementFast?.(el);
    },
};

/**
 * `GeoLeaf.Utils.createElement` — exposed by the core under the `$create` alias.
 *
 * Returns `HTMLElement`, never `null`: the core guarantees it
 * (`dom-helpers.ts`), and a nullable return propagated `'possibly null'`
 * to 31 sites of `modal-manager.ts`. The local `document.createElement(tag)`
 * fallback is exact for an absent core — it is what the core itself does, minus
 * its props/children.
 */
export function $create(tag: string, ...rest: unknown[]): HTMLElement {
    const create = _utils()?.createElement;
    return create ? create(tag, ...rest) : document.createElement(tag);
}

/**
 * `GeoLeaf.Utils.Formatters.formatFileSize` — human-readable byte size ("1.23 MB").
 *
 * Replaces `CacheCalculator.formatBytes`, which was only a wrapper over this
 * same core function but forced a deep import of `calculator.js` (465 l.,
 * carrying `Log`) into this plugin's bundle.
 *
 * ⚠️ NOT to be confused with `download-handler.ts`'s local
 * `FormatUtils.formatBytes`: that one has no KB step and ignores precision. The
 * two renderings differ.
 */
export function formatFileSize(
    bytes: number | null | undefined,
    options?: { precision?: number; locale?: string }
): string {
    return _utils()?.Formatters?.formatFileSize?.(bytes, options) ?? "";
}

/** `GeoLeaf.Utils.Formatters.toMB` */
export function toMB(bytes: number | null | undefined, precision?: number): string {
    return _utils()?.Formatters?.toMB?.(bytes, precision) ?? "";
}

/** `GeoLeaf.Utils.Formatters.toGB` */
export function toGB(bytes: number | null | undefined, precision?: number): string {
    return _utils()?.Formatters?.toGB?.(bytes, precision) ?? "";
}

/* 🛑 `formatDateTime` is REMOVED: its only consumer was the sync panel's backup
 * list, which dated each entry. The backup chain is deleted, so this accessor is
 * a callerless export. */

/**
 * `GeoLeaf.Utils.events` — the core's listener manager.
 *
 * Only `on` is consumed by this plugin; the facade stays deliberately narrow
 * rather than an untyped `Proxy`, which yielded `unknown` at first use and
 * failed the typecheck (TS18046).
 */
export const events = {
    /**
     * Signature modelled on the core's `event-listener-manager.ts`,
     * RETURN INCLUDED: `addEventListener` yields the listener's identifier, which
     * callers pass to `pushId(…)` to be able to remove it. An `unknown` return
     * failed the typecheck at the 3 sites (TS2345) — and I had not seen it,
     * because this package's `typecheck` script uses `tsconfig.typecheck.json`,
     * not `tsconfig.json`.
     */
    on: (
        target: EventTarget | null,
        event: string,
        handler: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
        label?: string
    ): number | null => {
        const bus = _utils()?.events as
            | {
                  on?: (
                      t: EventTarget | null,
                      e: string,
                      h: EventListenerOrEventListenerObject,
                      o?: boolean | AddEventListenerOptions,
                      l?: string
                  ) => number | null;
              }
            | undefined;
        return bus?.on?.(target, event, handler, options, label) ?? null;
    },
    /** `events.off(id)` — `on`'s counterpart. A caller casts to this shape (l.192). */
    off: (id: number): void => {
        const bus = _utils()?.events as { off?: (i: number) => void } | undefined;
        bus?.off?.(id);
    },
};
