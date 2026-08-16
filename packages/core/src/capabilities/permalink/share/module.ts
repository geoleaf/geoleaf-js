/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * ShareModule — `ICoreModule` wrapper for the Share / view-permalink subsystem.
 *
 * Represents: `GeoLeaf.Share` (modal dialog with copy-link + lazy QR code).
 *
 * Declares a mobile toolbar icon (share button) driven by `modules.permalink.share.enabled`
 * — share is a sub-feature of the permalink capability (S13 F7).
 * The desktop button is injected by the capability itself, which subscribes to the
 * kernel `geoleaf:desktop-panel:tabs-ready` seam (no static kernel→capability import).
 */

import type { ILifecycleModule, IModuleUISlot } from "../../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../../contracts/config.contract.ts";
import { ShareLifecycle } from "./lifecycle.js";

const _SHARE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/>' +
    '<path d="M16 6l-4-4-4 4"/>' +
    '<path d="M12 2v14"/>' +
    "</svg>";

/**
 * Represents the GeoLeaf Share subsystem (URL copy + lazy QR code).
 * Has no dependencies — relies only on the permalink-synced `window.location`.
 */
export class ShareModule implements ILifecycleModule {
    readonly id = "share" as const;
    readonly dependencies = [] as const;

    readonly ui: IModuleUISlot = {
        mobileIcon: {
            icon: _SHARE_ICON,
            labelKey: "share.toolbar.button",
            profileKey: "modules.permalink.share.enabled",
            defaultVisible: true,
            action: "share",
            // Explicit pill order (socle-init 7.5) — `share` stays after `legend` because it
            // is declared so, not because the manifest happens to install permalink last.
            order: 20,
        },
    };

    init(_adapter: IMapAdapter, _config: IGeoLeafConfig): void {
        ShareLifecycle.init();
    }

    destroy(): void {
        ShareLifecycle._reset();
    }
}
