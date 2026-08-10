/*!
 * @geoleaf/host-runtime — logger runtime seam
 * © 2026 Mattieu Pottier — MIT License
 *
 * Consolidated at STRUCT S2 (F1) from the three byte-identical copies carried by
 * `plugin-table`, `plugin-addpoi` and `plugin-storage` (X2e — normalized hash
 * `033aeed2cd5d` on all three).
 * https://geoleaf.dev
 */

/**
 * Runtime seam for the core logger.
 *
 * Delegates to the running core logger (`GeoLeaf.Log`) so plugin messages honour the
 * host log level. Level filtering, quiet mode and repetition damping all live in the
 * core (`packages/core/src/utils/log/logger.ts`, 260 LOC): this seam is an ACCESSOR,
 * not a second implementation — there is nothing here to drift, which is why no
 * `verify-seam-drift` pin exists for it.
 *
 * The lookup happens at CALL time, never at module evaluation: a plugin module may be
 * evaluated before the core finishes booting. When the core is unavailable (unit tests,
 * boot not reached), every method stays callable, spyable and a silent no-op. It does
 * NOT fall back to `console`: that would bypass the host log level, which is the whole
 * point of routing through the core.
 */

import { getGeoLeaf, type GeoLeafHost } from "./host.js";

/** The logger façade the core mounts on `GeoLeaf.Log`. */
type HostLogger = NonNullable<GeoLeafHost["Log"]>;

/** The four levels every plugin calls unconditionally, each optional-chained. */
export const Log = {
    debug: (...args: unknown[]): void => {
        getGeoLeaf()?.Log?.debug?.(...args);
    },
    info: (...args: unknown[]): void => {
        getGeoLeaf()?.Log?.info?.(...args);
    },
    warn: (...args: unknown[]): void => {
        getGeoLeaf()?.Log?.warn?.(...args);
    },
    error: (...args: unknown[]): void => {
        getGeoLeaf()?.Log?.error?.(...args);
    },
} satisfies Required<Pick<HostLogger, "debug" | "info" | "warn" | "error">>;
