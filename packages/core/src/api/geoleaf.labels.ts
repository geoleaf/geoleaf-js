/*!
 * GeoLeaf Core - Labels (public facade)
 * Released under the MIT License
 * © 2026 Mattieu Pottier
 * https://geoleaf.dev
 */

/**
 *
 * Public `GeoLeaf.Labels` facade — per-layer text labels rendered as a native
 * MapLibre `symbol` layer. In-core capability (S4, migrated from
 * `modules/optional/labels`). Mounted by `globals.ui.ts`.
 *
 * ⚠️ This header named the « Lite build » until 2026-08-19. **That build no longer exists** — its removal is motivated where it happened, in the bundle configuration, and the alternate mounting site these headers implied does not exist either. A build distinction that is gone does not read as stale: it reads as a live constraint, and a reader plans around it. Here it announced an EXCLUSION — a reader would look for the graph it names.
 *
 * Labels are opt-out: active unless `modules.labels.enabled` is `false`. The
 * layer manager injects a per-layer toggle button via the
 * `geoleaf:layer-item:controls` seam.
 */
import { buildPublicApi } from "../capabilities/labels/public-api.js";

/** The object mounted on `GeoLeaf.Labels`. */
export const Labels = buildPublicApi();
