/*!
 * GeoLeaf Core - Branding (public facade)
 * Released under the MIT License
 * © 2026 Mattieu Pottier
 * https://geoleaf.dev
 */

/**
 *
 * Public `GeoLeaf.Branding` facade — customisable branding text overlay on the
 * map. In-core capability (reclassified from `modules/built-in/ui/branding.ts`).
 * Mounted by `globals.ui.ts` / `globals.ui-lite.ts`.
 *
 * Branding is opt-in: inert unless `modules.branding.enabled` is `true`. Migrated
 * from the former app-global root `branding` key.
 */
import { buildPublicApi } from "../capabilities/branding/public-api.js";

/** The object mounted on `GeoLeaf.Branding`. */
export const Branding = buildPublicApi();
