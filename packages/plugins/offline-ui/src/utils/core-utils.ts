/*!
 * @geoleaf-plugins/offline-ui — Core utilities accessor
 * © 2026 Mattieu Pottier — MIT License
 *
 * ARCHI S7 (7.3, geste 5) — remplace les deep imports vers `@core/utils/**`.
 * Chaque helper est lu sur le namespace du core EN COURS D'EXÉCUTION
 * (`globalThis.GeoLeaf.Utils`), jamais importé : c'est ce qui permet au bundler de
 * cesser d'embarquer une copie du core.
 *
 * ⚠️ Contrairement à l'accesseur `Log`, ces fonctions RENDENT des valeurs. Un repli
 * silencieux masquerait une absence de core derrière un résultat plausible — d'où
 * les replis explicites et neutres ci-dessous (chaîne vide, `null`, no-op), qui
 * restent lisibles en test comme en production dégradée.
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
 * La tranche de `GeoLeaf.Utils` que ce plugin lit.
 *
 * STRUCT S2 (F7) — la recherche du namespace passe par `getGeoLeaf()` de
 * `@geoleaf/host-runtime` (qui teste aussi `window`) au lieu d'un accès direct à
 * `globalThis` : c'était le dernier endroit du plugin à refaire cette recherche. Le
 * NARROW vers {@link CoreUtils} reste local, et le doit : la tranche que lit storage
 * (`Formatters`, `createElement`, `events`) est disjointe de celle d'addpoi.
 */
function _utils(): CoreUtils | undefined {
    return getGeoLeaf()?.Utils as CoreUtils | undefined;
}

/** `GeoLeaf.Utils.DOMSecurity` — sanitisation DOM du core. No-op si le core est absent. */
export const DOMSecurity = {
    clearElement: (el: HTMLElement): void => {
        _utils()?.DOMSecurity?.clearElement?.(el);
    },
    clearElementFast: (el: HTMLElement): void => {
        _utils()?.DOMSecurity?.clearElementFast?.(el);
    },
};

/**
 * `GeoLeaf.Utils.createElement` — exposé par le core sous l'alias `$create`.
 *
 * Rend `HTMLElement`, jamais `null` : le core le garantit (`dom-helpers.ts:125-128`),
 * et un retour nullable propageait `'possibly null'` à 31 sites de `modal-manager.ts`.
 * Le repli local `document.createElement(tag)` est exact pour un core absent — c'est
 * ce que fait le core lui-même, sans ses props/enfants.
 */
export function $create(tag: string, ...rest: unknown[]): HTMLElement {
    const create = _utils()?.createElement;
    return create ? create(tag, ...rest) : document.createElement(tag);
}

/**
 * `GeoLeaf.Utils.Formatters.formatFileSize` — human-readable byte size ("1.23 MB").
 *
 * CAPACITÉS S1 — remplace `CacheCalculator.formatBytes`, qui n'était qu'un wrapper sur
 * cette même fonction du core mais imposait un deep import de `calculator.js` (465 l.,
 * porteur de `Log`) dans le bundle de ce plugin.
 *
 * ⚠️ À NE PAS confondre avec le `FormatUtils.formatBytes` local de `download-handler.ts` :
 * celui-ci n'a pas de palier KB et ignore la précision. Les deux rendus diffèrent.
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

/* 🛑 `formatDateTime` est RETIRÉE (tâche 4.11) : son seul consommateur était la liste de
 * sauvegardes du panneau de synchronisation, qui datait chaque entrée. La chaîne de sauvegarde
 * est supprimée, donc cet accesseur est un export sans appelant — compteur C1. */

/**
 * `GeoLeaf.Utils.events` — gestionnaire d'écouteurs du core.
 *
 * Seul `on` est consommé par ce plugin ; la façade reste volontairement étroite
 * plutôt qu'un `Proxy` non typé, qui rendait des `unknown` au premier usage et
 * faisait échouer le typecheck (TS18046).
 */
export const events = {
    /**
     * Signature calquée sur `event-listener-manager.ts:196-202` du core, RETOUR COMPRIS :
     * `addEventListener` rend l'identifiant de l'écouteur, que les appelants passent à
     * `pushId(…)` pour pouvoir le retirer. Un retour `unknown` faisait échouer le
     * typecheck aux 3 sites (TS2345) — et je ne l'avais pas vu, parce que le script
     * `typecheck` de ce package utilise `tsconfig.typecheck.json`, pas `tsconfig.json`.
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
    /** `events.off(id)` — pendant de `on`. Un appelant caste vers cette forme (l.192). */
    off: (id: number): void => {
        const bus = _utils()?.events as { off?: (i: number) => void } | undefined;
        bus?.off?.(id);
    },
};
