/*!
 * GeoLeaf Core - Scale (public facade)
 * Released under the MIT License
 * © 2026 Mattieu Pottier
 * https://geoleaf.dev
 */

"use strict";
/**
 *
 * Public `GeoLeaf.Scale` facade — graphical + numeric scale bar and zoom-level
 * indicator. In-core capability (reclassified from
 * `modules/built-in/map/scale-control.ts`). Mounted by `globals.ui.ts` /
 * `globals.ui-lite.ts`.
 *
 * Scale is opt-out: active unless `modules.scale.enabled` is `false`. Migrated from
 * the former `ui.showScale` flag + `scaleConfig` block. The scale/zoom math
 * (`scale-utils.ts`) stays kernel.
 */
import { buildPublicApi } from "../capabilities/scale/public-api.js";

/** The object mounted on `GeoLeaf.Scale`. */
export const Scale = buildPublicApi();
