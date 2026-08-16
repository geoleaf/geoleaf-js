/*!
 * GeoLeaf Core - Geolocation (public facade)
 * Released under the MIT License
 * © 2026 Mattieu Pottier
 * https://geoleaf.dev
 */

/**
 *
 * Public `GeoLeaf.Geolocation` facade — GPS button + state seam. In-core capability
 * (reclassified from `modules/built-in/ui/control-geolocation.ts`). Mounted by
 * `globals.ui.ts` / `globals.ui-lite.ts`.
 *
 * Geolocation is opt-out: the button is active unless `modules.geolocation.enabled`
 * is `false`. Migrated from the former `ui.showGeolocation` flag. `getState()` is the
 * public seam for the GPS state singleton (read by plugin-addpoi).
 */
import { buildPublicApi } from "../capabilities/geolocation/public-api.js";

/** The object mounted on `GeoLeaf.Geolocation`. */
export const Geolocation = buildPublicApi();
