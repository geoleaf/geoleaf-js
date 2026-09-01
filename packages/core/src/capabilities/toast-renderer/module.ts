/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * ToastRendererModule — `ICoreModule` wrapper for the in-core toast-renderer capability.
 *
 * Represents the DOM renderer of the notification/toast subsystem. Relocated to
 * `capabilities/toast-renderer/` (S7, from `modules/built-in/ui/notifications` +
 * `app/init-notifications`). The kernel keeps the lossy `notify()` primitive
 * (anchor B2); this module owns the renderer lifecycle.
 *
 * Registered conditionally in `boot.ts` when `modules.toast-renderer.enabled` is
 * set (opt-out). `init()` wires the capability lifecycle (container +
 * `registerRenderer()` + boot loading toast + profile/theme listeners);
 * `destroy()` tears it down.
 *
 * Depends on `config` only — never on `ui`: a `ui` dependency would let the
 * topological sort delay init until after `UIModule.init()`, which drives feature
 * setup eagerly and would deadlock (cf. `route.module.ts`). The renderer only
 * needs the DOM + i18n + the primitive, and its boot events (`theme:applying`,
 * `theme:applied`) fire asynchronously after config fetch, so listeners attached
 * during the registry pass are always in place.
 *
 * ⚠️ It declared `["geojson"]` until 28/07/2026. That was an ORDERING trick,
 * not a need — the paragraph above already says the renderer needs no layer data —
 * and it turned into a production defect once `GeoJSONModule.init()` began awaiting
 * phase-1 layer loading (F0/S8). The registry init loop is sequential and awaited
 * (`app/module-registry.ts`), so the renderer could not mount until every
 * default-theme layer had resolved. Before that, `#gl-notifications` does not exist
 * and `notify()` degrades to its console buffer: notifications were invisible during
 * exactly the window where load errors happen. Measured on `tourism` once two
 * external layers sat in the booted theme — a burst of 8 error toasts rendered 0
 * (`e2e/vn-toasts.spec.js`, D.3).
 *
 * The same ordering trick is still carried by `labels`, `feature-info` and `filter`.
 */

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { ToastRendererLifecycle } from "./lifecycle.js";

/**
 * Represents the GeoLeaf toast renderer (DOM notifications).
 * Depends on `config` (never `ui` — deadlock; never `geojson` — see module doc).
 */
export class ToastRendererModule implements ILifecycleModule {
    readonly id = "toast-renderer" as const;
    readonly dependencies = ["config"] as const;

    init(_adapter: IMapAdapter, _config: IGeoLeafConfig): void {
        ToastRendererLifecycle.init();
    }

    destroy(): void {
        ToastRendererLifecycle._reset();
    }
}
