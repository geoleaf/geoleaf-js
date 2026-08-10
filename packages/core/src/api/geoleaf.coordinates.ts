/*!
 * GeoLeaf Core - Coordinates (public facade)
 * Released under the MIT License
 * © 2026 Mattieu Pottier
 * https://geoleaf.dev
 */

"use strict";
/**
 *
 * Public `GeoLeaf.Coordinates` facade — real-time cursor coordinates readout.
 * In-core capability (reclassified from `modules/built-in/ui/coordinates-display.ts`).
 * Mounted by `globals.ui.ts` / `globals.ui-lite.ts`.
 *
 * Coordinates are opt-out: active unless `modules.coordinates.enabled` is `false`.
 * Migrated from the former `ui.showCoordinates` flag.
 */
import { buildPublicApi } from "../capabilities/coordinates/public-api.js";

/** The object mounted on `GeoLeaf.Coordinates`. */
export const Coordinates = buildPublicApi();
